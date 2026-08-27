"""
Reading Dex's credential store from Python.

The TypeScript core keeps secrets encrypted with Windows DPAPI under
%LOCALAPPDATA%\\DEX\\credentials (see core/secrets/credential_store.ts). The
agent servers are separate Python processes, and without this they would have to
fall back to plaintext in .env — which SAFETY.md rules out and which would make
the credential store a half-measure.

Same format, same DPAPI CurrentUser scope, same base64-over-stdin transport so
no console codepage can corrupt a key on the way through.
"""
from __future__ import annotations

import base64
import os
import re
import subprocess
from pathlib import Path

_NAME_RE = re.compile(r'^[a-z0-9][a-z0-9_.-]{0,63}$')

_UNPROTECT = """
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$prot  = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($prot, $null, 'CurrentUser')
[Console]::Out.Write([Convert]::ToBase64String($bytes))
"""


def _store_dir() -> Path:
    base = os.environ.get('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
    return Path(base) / 'DEX' / 'credentials'


def get_credential(name: str) -> str | None:
    """The stored secret, or None if it is not set or cannot be decrypted."""
    if not _NAME_RE.match(name):
        raise ValueError(f'Invalid credential name: {name!r}')

    path = _store_dir() / f'{name}.dpapi'
    if not path.exists():
        return None

    try:
        encoded = base64.b64encode(_UNPROTECT.encode('utf-16-le')).decode()
        result = subprocess.run(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
            input=path.read_text(encoding='utf-8'),
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        return base64.b64decode(result.stdout.strip()).decode('utf-8')
    except Exception:  # noqa: BLE001 - a missing key is a normal state, not a crash
        return None


def resolve(name: str, env_var: str | None = None) -> str | None:
    """
    Store first, environment second.

    The env fallback exists so a fresh checkout can start, and it warns each
    time — plaintext on disk is a migration state, not a resting place.
    """
    value = get_credential(name)
    if value:
        return value

    from_env = os.environ.get(env_var) if env_var else None
    if from_env:
        print(
            f'\033[33m[credentials]\033[0m "{name}" is coming from {env_var} in plaintext. '
            f'Move it into the OS store: npm run cred -- set {name}'
        )
    return from_env
