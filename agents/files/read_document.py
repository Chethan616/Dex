"""
The text of a document, so Dex can say what is in it.

A curriculum, a syllabus, an invoice, a timetable — the things worth fetching
from a portal — arrive as PDFs. `read_file` handed one of those back as a few
kilobytes of binary with a handful of recognisable words in it, which is worse
than failing: it looks like content, and anything built on top of it produces a
confident summary of noise.

pypdf, which is already installed here. Deliberately not a heavier engine: this
extracts text that is already in the file, and a PDF with no text layer is a
scan. That case is detected and said out loud rather than silently returning
nothing, because "this document is images" is a real answer and an empty string
is not.

Called as a subprocess by file_ops.readDocument, which is how every other Python
in the files agent is reached.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

DEFAULT_MAX_CHARS = 60_000


def read_document(path: str, max_chars: int = DEFAULT_MAX_CHARS) -> dict:
    source = Path(path)
    suffix = source.suffix.lower()

    if suffix == '.pdf':
        return _pdf(source, max_chars)

    # Plain text of any flavour. Read as UTF-8 with replacement rather than
    # strictly: a log or a CSV with one bad byte should still be readable.
    if suffix in ('.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', ''):
        text = source.read_text(encoding='utf8', errors='replace')
        return _result(source, text, max_chars, pages=None, kind='text')

    raise ValueError(
        f'Dex cannot read {suffix or "that"} documents yet. PDFs and text files work.'
    )


def _pdf(source: Path, max_chars: int) -> dict:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - the dependency is present
        raise RuntimeError('pypdf is not installed: pip install pypdf') from exc

    reader = PdfReader(str(source))

    if reader.is_encrypted:
        # An empty password opens most "protected" PDFs — they are protected
        # against editing, not reading. If it does not, say so plainly.
        try:
            reader.decrypt('')
        except Exception:  # noqa: BLE001
            raise ValueError(
                f'{source.name} is password-protected. Dex cannot open it.'
            ) from None

    chunks = []
    for page in reader.pages:
        try:
            chunks.append(page.extract_text() or '')
        except Exception:  # noqa: BLE001 - one unreadable page is not the document
            chunks.append('')

    text = '\n\n'.join(c for c in chunks if c.strip())

    if not text.strip():
        raise ValueError(
            f'{source.name} has {len(reader.pages)} page(s) but no text layer — '
            'it is a scan or an export of images. Reading it would need OCR, '
            'which Dex does not do.'
        )

    return _result(source, text, max_chars, pages=len(reader.pages), kind='pdf')


def _result(source: Path, text: str, max_chars: int, pages, kind: str) -> dict:
    cleaned = '\n'.join(line.rstrip() for line in text.splitlines())
    # Collapse the runs of blank lines a PDF extractor leaves behind, which
    # otherwise make up most of the character budget.
    while '\n\n\n' in cleaned:
        cleaned = cleaned.replace('\n\n\n', '\n\n')
    cleaned = cleaned.strip()

    truncated = len(cleaned) > max_chars
    return {
        'path': str(source),
        'name': source.name,
        'kind': kind,
        'pages': pages,
        'chars': len(cleaned),
        'truncated': truncated,
        'text': cleaned[:max_chars],
    }


if __name__ == '__main__':
    target = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_MAX_CHARS
    try:
        print(json.dumps(read_document(target, limit)))
    except Exception as exc:  # noqa: BLE001 - the message is the product here
        print(str(exc), file=sys.stderr)
        sys.exit(1)
