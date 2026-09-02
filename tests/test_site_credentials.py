"""
The one place Dex types a password, and the boundary that makes it safe.

    npm run test:site-creds

Dex's standing rule is that it never fills a password, and `type_text` still
enforces exactly that. What `sign_in` adds is a narrow exception: a credential
the owner stored by hand, for one host, filled on that host and nowhere else.

The whole value of the exception rests on the binding being exact, so that is
what this file is about. A credential offered to a lookalike domain is not a
smaller version of the feature working — it is the feature being a phishing
vector, because the page that receives the keystrokes is chosen by whatever the
browser last navigated to, and a task can be steered by a link on a page Dex
read.

The cases that matter are all "close but not equal":

    vtop.vit.ac.in            the credential's host          fill
    vtop.vit.ac.in:8443       same host, different port      fill
    vtop.vit.ac.in.evil.com   suffix attack                  never
    sub.vtop.vit.ac.in        a subdomain is a different host never
    vtop.vit.ac.in.            trailing-dot form              fill
    xn--vtp-...               punycode lookalike             never
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'agents' / 'browser'))

import site_credentials as sc  # noqa: E402

failures = 0


def check(label: str, condition: bool, detail: str = '') -> None:
    global failures
    if condition:
        print(f'ok   {label}')
    else:
        failures += 1
        print(f'FAIL {label}' + (f' — {detail}' if detail else ''))


# ---------------------------------------------------------------------------
# The store is not touched. A test that writes the owner's real credential
# directory is a test that can lose a credential, and DPAPI ciphertext cannot
# be reconstructed from anything this file knows.
# ---------------------------------------------------------------------------

_FAKE: dict[str, str] = {}


def _fake_read(name: str) -> str | None:
    return _FAKE.get(name)


sc._read = _fake_read  # type: ignore[assignment]

_FAKE['site.vtop.vit.ac.in'] = json.dumps(
    {'username': '21BCE1234', 'password': 'not-a-real-password'}
)
_FAKE['site.example.org'] = json.dumps({'username': 'someone', 'password': 'x'})


print('— the host is read the same way on both sides —')

for written, expected in [
    ('vtop.vit.ac.in', 'vtop.vit.ac.in'),
    ('https://vtop.vit.ac.in', 'vtop.vit.ac.in'),
    ('https://vtop.vit.ac.in/vtop/login?x=1', 'vtop.vit.ac.in'),
    ('HTTPS://VTOP.VIT.AC.IN/vtop', 'vtop.vit.ac.in'),
    ('https://vtop.vit.ac.in:8443/vtop', 'vtop.vit.ac.in'),
    # A trailing dot is the fully-qualified form of the same name, and a
    # browser will happily navigate to it.
    ('https://vtop.vit.ac.in./vtop', 'vtop.vit.ac.in'),
]:
    check(f'{written} -> {expected}', sc.host_of(written) == expected, sc.host_of(written))


print('\n— the credential is offered to the host it was stored for —')

found = sc.lookup('https://vtop.vit.ac.in/vtop/login')
check('the exact host gets it', found is not None)
check('and it is the right one', bool(found) and found['username'] == '21BCE1234')
check('the host comes back with it, for the caller to re-check',
      bool(found) and found['host'] == 'vtop.vit.ac.in')

check('a different port is the same host', sc.lookup('https://vtop.vit.ac.in:8443/x') is not None)
check('the trailing-dot form is the same host', sc.lookup('https://vtop.vit.ac.in./x') is not None)
check('http is the same host too', sc.lookup('http://vtop.vit.ac.in/x') is not None)


print('\n— and to nothing else —')

for hostile, why in [
    ('https://vtop.vit.ac.in.evil.com/login', 'a suffix attack'),
    ('https://vtop.vit.ac.in-evil.com/login', 'a hyphen lookalike'),
    ('https://sub.vtop.vit.ac.in/login', 'a subdomain is a different host'),
    ('https://vit.ac.in/login', 'the parent domain'),
    ('https://vtop.vit.ac.in@evil.com/login', 'userinfo before the real host'),
    ('https://evil.com/?next=https://vtop.vit.ac.in', 'the host in a query string'),
    ('https://evil.com/#vtop.vit.ac.in', 'the host in a fragment'),
    ('https://vtopvit.ac.in/login', 'a missing dot'),
    ('', 'nothing at all'),
    ('not a url', 'not a url'),
]:
    check(f'refused: {why}', sc.lookup(hostile) is None, f'{hostile} was offered a credential')


print('\n— an unknown site gets nothing rather than someone else\'s credential —')

check('a site with no credential', sc.lookup('https://github.com/login') is None)
check('a site with its own credential gets its own',
      (sc.lookup('https://example.org/in') or {}).get('username') == 'someone')


print('\n— a malformed credential is ignored, not half-used —')

_FAKE['site.broken.test'] = 'this is not json'
check('unparseable', sc.lookup('https://broken.test/') is None)

_FAKE['site.empty.test'] = json.dumps({'username': '', 'password': ''})
check('empty on both fields', sc.lookup('https://empty.test/') is None)

_FAKE['site.list.test'] = json.dumps(['not', 'an', 'object'])
check('the wrong shape entirely', sc.lookup('https://list.test/') is None)

_FAKE['site.partial.test'] = json.dumps({'username': 'only-a-name'})
partial = sc.lookup('https://partial.test/')
check('a username with no password is still usable', partial is not None)
check('and the missing password is empty, not None',
      bool(partial) and partial['password'] == '')


print('\n— the store is the same one the TypeScript side writes —')

check('same directory', sc.store_dir().name == 'credentials'
      and sc.store_dir().parent.name == 'DEX')
check('same naming scheme', sc.credential_name('vtop.vit.ac.in') == 'site.vtop.vit.ac.in')


print()
if failures:
    print(f'{failures} check(s) failed.')
    sys.exit(1)
print('PASSED  a stored credential is offered to one host and no other.')
