"""
Registry write-policy checks.

A standalone file rather than a string embedded in the TypeScript suite,
because registry paths are made of backslashes and passing them through a
template literal into `python -c` mangles every one of them. The first version
of this check "failed" purely because `HKCU\\Software\\DEX` had arrived as
`HKCU\\\\Software\\\\DEX`.

Prints one JSON object for the caller to assert on.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / 'daemon' / 'handlers'))

from registry_handler import RegistryHandler, classify_write  # noqa: E402

BANDS = {
    r'HKCU\Software\DEX\x': 'green',
    r'HKEY_CURRENT_USER\Software\DEX\x': 'green',
    r'HKCU\Control Panel\Desktop': 'green',
    r'HKCU\Software\Acme\x': 'amber',
    r'HKLM\SOFTWARE\Vendor\App': 'amber',
    r'HKLM\SYSTEM\CurrentControlSet\Services\x': 'red',
    r'HKLM\SOFTWARE\Policies\x': 'red',
    r'HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run': 'red',
    r'HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon': 'red',
    r'HKLM\SOFTWARE\Microsoft\Windows Defender': 'red',
}

RED_PATH = r'HKLM\SYSTEM\CurrentControlSet\Services\x'
AMBER_PATH = r'HKCU\Software\Acme\x'


def _write_refused(path: str, full_access: str) -> bool:
    """True when the write was refused by policy (not by some other error)."""
    os.environ['DEX_FULL_ACCESS'] = full_access
    try:
        RegistryHandler.write({'path': path, 'name': 'dex_test', 'value': 'v'})
        return False
    except PermissionError:
        return True
    except Exception:
        # Anything else means it got past policy and failed on Windows itself,
        # which for this test is the same as not being refused.
        return False


def main() -> int:
    wrong = [
        f'{path} -> {classify_write(path)[0]} (want {want})'
        for path, want in BANDS.items()
        if classify_write(path)[0] != want
    ]

    result = {
        'wrong_bands': wrong,
        # The rule that matters most: Full Access grants elevation, never
        # permission to touch security surfaces.
        'red_refused_with_full_access': _write_refused(RED_PATH, 'true'),
        'amber_gated_without_full_access': _write_refused(AMBER_PATH, 'false'),
    }
    print(json.dumps(result))
    return 0


if __name__ == '__main__':
    sys.exit(main())
