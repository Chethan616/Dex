"""
The file index, tested against the two searches that failed.

Both are real requests that came back wrong, and they fail in different ways,
so both are here as fixtures rather than as one:

    find UI.png on my desktop           the name was exact and the file was in
                                        the index, and it still lost — every
                                        file under the UI folder matched "ui",
                                        so it was cut by LIMIT before the
                                        extension filter ever ran
    search for aadhaar card files       the name says nothing. `scan001.jpg` is
                                        found only by the word printed on it,
                                        which means OCR at index time

Run: python tests/test_index.py
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agents' / 'files'))

WORK = Path(tempfile.mkdtemp(prefix='dex-index-test-'))
os.environ['DEX_INDEX_DB'] = str(WORK / 'index.db')

from indexer import crawl, extract, search, store  # noqa: E402

passed = failed = 0


def check(name: str, condition: bool, detail: str = '') -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f'  ok    {name}')
    else:
        failed += 1
        print(f'  FAIL  {name}' + (f' -- {detail}' if detail else ''))


PNG = bytes([0x89]) + b'PNG' + bytes([13, 10, 26, 10])


def make_tree(root: Path) -> None:
    """A miniature of the disk that produced the failures."""
    (root / 'Desktop' / 'UI' / 'UI INSPIRATIONS').mkdir(parents=True)
    (root / 'Desktop' / 'UI' / 'UI INSPIRATIONS' / 'UI.png').write_bytes(b'\x89PNG\r\n\x1a\n')
    # The decoys: every one of these matches the word "ui" too.
    for i in range(40):
        (root / 'Desktop' / 'UI' / f'inspiration_{i:02d}.png').write_bytes(b'\x89PNG\r\n\x1a\n')

    # Content, not name. A document whose filename is deliberately useless.
    (root / 'Documents').mkdir(parents=True)
    (root / 'Documents' / 'scan001.txt').write_text(
        'GOVERNMENT OF INDIA\nAADHAAR\n1234 5678 9012\n', encoding='utf-8')

    # Build output, which is what a search for "aadhar" used to return.
    junk = root / 'project' / 'build' / 'intermediates'
    junk.mkdir(parents=True)
    (junk / 'values-ar.xml').write_text('<resources/>', encoding='utf-8')
    (junk / 'aadhar_res.png.flat').write_bytes(b'flat')
    modules = root / 'project' / 'node_modules' / 'thing'
    modules.mkdir(parents=True)
    (modules / 'ui.png').write_bytes(PNG)

    # Every AI tool's cache. A first crawl spent 21,000 files and 1,885 OCR
    # calls inside these and had still not reached the Desktop.
    for tool in ('.codex', '.gemini', '.claude', '.antigravity-ide', '.cursor'):
        cache = root / tool / 'sessions'
        cache.mkdir(parents=True)
        (cache / 'aadhaar_prompt.png').write_bytes(PNG)
        (cache / 'ui.png').write_bytes(PNG)

    # Where phone transfers land, and therefore where a scan actually is.
    phone = root / 'CrossDevice' / 'OnePlus 11R 5G' / 'storage' / 'Download'
    phone.mkdir(parents=True)
    (phone / 'aadhar.txt').write_text('AADHAAR 1234 5678 9012', encoding='utf-8')


print('file index')
home = WORK / 'home'
make_tree(home)
report = crawl.crawl(scope=str(home))
check('crawl indexes the tree', report['indexed'] > 40, str(report))

# --- what must never be indexed ---------------------------------------------
paths = [r[0] for r in store.connect().execute('SELECT path FROM files')]
check('build output is not indexed', not any('intermediates' in p for p in paths))
check('node_modules is not indexed', not any('node_modules' in p for p in paths))
check('dotted tool caches are not indexed',
      not any(f'{os.sep}.' in p for p in paths),
      str([p for p in paths if f'{os.sep}.' in p][:2]))
check('a phone-transfer folder IS indexed', any('CrossDevice' in p for p in paths))

# --- the UI.png failure ------------------------------------------------------
found = search.search('find UI.png on my desktop', limit=5)
names = [m['name'] for m in found['matches']]
check('UI.png is found at all', 'UI.png' in names, str(names[:5]))
check('UI.png ranks first among 40 decoys', names[:1] == ['UI.png'], str(names[:3]))
check('and it says why', 'filename' in found['matches'][0]['why'] if names else False)

# --- the Aadhaar failure -----------------------------------------------------
found = search.search('Search for aadhar card files in my pc', limit=5)
names = [m['name'] for m in found['matches']]
check('a card named scan001 is found by its text', 'scan001.txt' in names, str(names[:5]))
check('"aadhar" also searches for "uidai"', 'uidai' in found['searched_for'])
check('no build junk in the answer', not any('.flat' in n for n in names), str(names))

# --- the owner's folders are crawled before their tool caches ----------------
ordered = [str(r) for r in crawl.roots('profile')]
check('the crawl starts in the owner folders, not alphabetically',
      any(r.lower().endswith('desktop') for r in ordered[:3]), str(ordered[:3]))
check('the home directory comes after them', ordered[-1] == str(Path.home()), ordered[-1])
check('"pc" reaches every drive, network included',
      len(crawl.roots('pc')) > len(crawl.roots('profile')))
check('a moved folder is found where Windows says it is, not where it used to be',
      crawl.known_folder('Desktop') is None
      or crawl.known_folder('Desktop').is_dir(),
      str(crawl.known_folder('Desktop')))

# --- a scan on the phone transfer folder ------------------------------------
found = search.search('aadhar card', limit=5)
check('a card in the CrossDevice folder is found',
      any('CrossDevice' in m['path'] for m in found['matches']),
      str([m['path'][-40:] for m in found['matches'][:3]]))

# --- extensions are a filter, not a search term ------------------------------
words, extensions = search.terms_of('find aadhar card png jpeg or pdf in my pc')
check('extensions are separated out', extensions == ['png', 'jpeg', 'pdf'], str(extensions))
check('and are not searched for', words == ['aadhar', 'card'], str(words))
check('"jpeg" also covers .jpg', 'jpg' in search.widen(['jpeg']))
check('"docx" also covers .doc', set(search.widen(['docx'])) == {'doc', 'docx'})

found = search.search('find png files called inspiration', limit=50)
check('an extension filter excludes other types',
      all(m['ext'] == '.png' for m in found['matches']), str(found['matches'][:2]))

# --- a scoped crawl must not delete the rest of the index --------------------
other = WORK / 'elsewhere'
other.mkdir()
(other / 'note.txt').write_text('hello', encoding='utf-8')
before = store.stats()['files']
crawl.crawl(scope=str(other))
after = store.stats()['files']
check('a crawl of one folder keeps the rest of the index',
      after == before + 1, f'{before} -> {after}')

# --- only one crawler at a time ----------------------------------------------
check('a second crawl stands down while one is running',
      (store.claim('x') is True) and (store.claim('y') is False))
store.release()
check('and the claim is free again once it is released', store.claim('z') is True)
store.release()

# --- rescanning is cheap -----------------------------------------------------
again = crawl.crawl(scope=str(home))
check('unchanged files are not re-read', again['unchanged'] > 40 and again['indexed'] == 0,
      str(again))

# --- the CLI the core actually calls ----------------------------------------
import json  # noqa: E402
import subprocess  # noqa: E402

result = subprocess.run(
    [sys.executable, '-m', 'indexer.cli', 'search', 'aadhaar', '--limit', '3'],
    cwd=str(Path(__file__).resolve().parents[1] / 'agents' / 'files'),
    capture_output=True, text=True, env={**os.environ},
)
check('the CLI exits clean', result.returncode == 0, result.stderr[-200:])
try:
    payload = json.loads(result.stdout)
    check('the CLI prints one JSON document', isinstance(payload.get('matches'), list))
except json.JSONDecodeError as exc:
    check('the CLI prints one JSON document', False, str(exc))

result = subprocess.run(
    [sys.executable, '-m', 'indexer.cli', 'search', ''],
    cwd=str(Path(__file__).resolve().parents[1] / 'agents' / 'files'),
    capture_output=True, text=True, env={**os.environ},
)
check('an empty query is still valid JSON, not a traceback',
      result.stdout.strip().startswith('{'), result.stdout[:80])

# --- OCR, if this machine has it ---------------------------------------------
if extract.ocr_available():
    print('  (Windows OCR is available)')
else:
    print('  (skipped: Windows OCR is not available on this machine)')

store.connect().close()
shutil.rmtree(WORK, ignore_errors=True)

print(f'\n{passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
