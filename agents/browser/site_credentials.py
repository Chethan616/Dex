"""
The one place a stored password is read, and the rules that make that safe.

Dex's standing rule is that it never types a password, and `primitives.type_text`
still enforces exactly that — point it at a password field and it refuses, no
matter what the selector says. That rule is right, because a general-purpose
typing primitive driven by a model reading untrusted pages is precisely how a
credential ends up somewhere it should not be.

What this adds is a narrow, owner-configured exception for signing in to a site
the owner explicitly stored a credential for. Four properties do the work, and
each is enforced here rather than promised in a comment:

  **Exact origin.** A credential stored for `vtop.vit.ac.in` is offered to
  `https://vtop.vit.ac.in/...` and to nothing else — not to a subdomain, not to
  `vtop.vit.ac.in.evil.com`, not to a page that redirected off-origin between
  the navigation and the form. The page's *current* URL decides, after
  redirects, because that is the page the keystrokes would land on.

  **The model never sees it.** The planner emits `sign_in { url }`. Nothing in
  the plan, the prompt, the event stream, the transcript or the telemetry
  database ever contains the secret: it is read here, in the agent process, at
  the moment of typing. That is the property that actually matters, because
  everything else Dex says about what it is doing is recorded somewhere.

  **Read directly from DPAPI, not passed in.** The credential does not travel
  over the agent's own HTTP boundary. The ciphertext is bound to this Windows
  account on this machine, so a copied file is worthless.

  **Stored by hand, never learned.** There is no code path that writes a
  credential from something a model produced or a page contained.

The store is the same one `core/secrets/credential_store.ts` writes — same
directory, same DPAPI scope, same file format — so `npm run cred -- set
site.vtop.vit.ac.in` and this read the same bytes. Reading it here rather than
adding a second store is deliberate: two credential stores is one too many.
"""
from __future__ import annotations

import base64
import ctypes
import json
import logging
import os
import re
from ctypes import wintypes
from pathlib import Path
from urllib.parse import urlparse

log = logging.getLogger('SiteCredentials')

# Matches core/secrets/credential_store.ts.
NAME_RE = re.compile(r'^[a-z0-9][a-z0-9_.-]{0,63}$')


def store_dir() -> Path:
    base = os.environ.get('LOCALAPPDATA') or os.path.join(
        os.environ.get('USERPROFILE', '.'), 'AppData', 'Local',
    )
    return Path(base) / 'DEX' / 'credentials'


def host_of(url: str) -> str:
    """
    The bare hostname, lowercased, without a port.

    Used for both sides of the origin comparison, so the comparison is between
    two values produced the same way rather than between a stored string and
    whatever a URL happened to look like.
    """
    try:
        parsed = urlparse(url if '://' in (url or '') else f'https://{url}')
    except ValueError:
        return ''
    return (parsed.hostname or '').lower().strip('.')


def credential_name(host: str) -> str:
    return f'site.{host}'


def lookup(url: str) -> dict | None:
    """
    The credential for this exact page, or None.

    None covers every uninteresting case — no credential stored, a different
    host, an unreadable file — because the caller's response to all of them is
    the same: hand off to the owner.
    """
    host = host_of(url)
    if not host:
        return None

    name = credential_name(host)
    if not NAME_RE.match(name):
        # A hostname with characters a credential name cannot hold. Nothing was
        # stored under it, so nothing can match it.
        return None

    raw = _read(name)
    if raw is None:
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        log.warning('credential %s is not readable as JSON', name)
        return None

    if not isinstance(data, dict):
        return None

    username = str(data.get('username') or '')
    password = str(data.get('password') or '')
    if not username and not password:
        return None

    # The host is carried back so the caller can prove, at the moment of
    # typing, that the page it is about to type into is still this one.
    return {'host': host, 'username': username, 'password': password}


def _read(name: str) -> str | None:
    """Decrypt one credential file. Returns None rather than raising."""
    path = store_dir() / f'{name}.dpapi'
    if not path.exists():
        return None

    try:
        ciphertext = base64.b64decode(path.read_text(encoding='utf8').strip())
    except Exception:  # noqa: BLE001
        log.warning('credential %s is not valid base64', name)
        return None

    try:
        plain = _unprotect(ciphertext)
    except OSError as exc:
        # Almost always the file was copied from another machine or account.
        log.warning('could not decrypt credential %s: %s', name, exc)
        return None

    try:
        # The TypeScript store base64-encodes the value before protecting it.
        return base64.b64decode(plain).decode('utf8')
    except Exception:  # noqa: BLE001
        return plain.decode('utf8', errors='replace')


# ---------------------------------------------------------------------------
# DPAPI
# ---------------------------------------------------------------------------

class _Blob(ctypes.Structure):
    _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]


def _unprotect(ciphertext: bytes) -> bytes:
    """
    CryptUnprotectData, CurrentUser scope, no entropy.

    Matches what the TypeScript store's PowerShell does exactly —
    `ProtectedData.Unprotect(bytes, null, 'CurrentUser')`. Called through ctypes
    rather than by shelling out to PowerShell because this runs on the path
    where a password is about to be typed, and a subprocess is one more place
    the plaintext could be observed.
    """
    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)

    buffer = ctypes.create_string_buffer(ciphertext, len(ciphertext))
    source = _Blob(len(ciphertext), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    result = _Blob()

    ok = crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(result),
    )
    if not ok:
        raise OSError(ctypes.get_last_error(), 'CryptUnprotectData failed')

    try:
        return ctypes.string_at(result.pbData, result.cbData)
    finally:
        # The decrypted bytes are in a heap block DPAPI allocated. Free it
        # rather than leaving plaintext in the process for the GC to find.
        kernel32.LocalFree(result.pbData)
