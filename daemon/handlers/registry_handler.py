import logging
import os
import re

log = logging.getLogger('RegistryHandler')

# -- Write policy -------------------------------------------------------------
#
# The registry is not one risk level, so it does not get one rule. Three bands:
#
#   GREEN  runs silently. Keys Dex owns, and the specific tweaks whose effect it
#          actually understands.
#   AMBER  runs only after the owner confirms. Ordinary application settings.
#   RED    is refused outright, and stays refused under Full Access.
#
# That last part is the important one. Full Access means the owner pre-granted
# *elevation*, so Dex stops asking for admin. SAFETY.md's "never change Windows
# security or privacy settings" is a different rule serving a different purpose,
# and collapsing the two would quietly turn a convenience toggle into a security
# bypass. Elevation decides who gets asked; RED decides what is done at all.

GREEN_PREFIXES = [
    r'HKEY_CURRENT_USER\Software\DEX',
    r'HKEY_LOCAL_MACHINE\SOFTWARE\DEX',
    r'HKCU\Software\DEX',
    r'HKLM\SOFTWARE\DEX',
    # Known-effect tweaks named in architecture.md's optimise composites.
    r'HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced',
    r'HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced',
    r'HKEY_CURRENT_USER\Control Panel\Desktop',
    r'HKCU\Control Panel\Desktop',
]

# Matched case-insensitively against the whole path.
RED_PATTERNS = [
    (r'\\Policies\\', 'Group Policy'),
    (r'\\CurrentControlSet\\Services\\', 'device drivers and services'),
    (r'\\Winlogon', 'the logon process'),
    (r'\\Lsa\b', 'Local Security Authority'),
    (r'Windows\s*Defender', 'Windows Defender'),
    (r'\\SecurityProviders', 'security providers'),
    (r'\\SystemCertificates', 'certificate trust'),
    (r'\\Cryptography\\', 'cryptography settings'),
    (r'Image File Execution Options', 'debugger hijacking'),
    (r'\\CurrentVersion\\Run(Once)?\b', 'autostart programs'),
    (r'EnableLUA|ConsentPrompt|\\UAC\b', 'User Account Control'),
]


def classify_write(path):
    """
    Return (band, reason) for a registry path: 'green' | 'amber' | 'red'.

    Pure and importable, so the policy can be unit-tested without a daemon, a
    named pipe, or an elevated process.
    """
    normalised = (path or '').replace('/', '\\')

    for pattern, what in RED_PATTERNS:
        if re.search(pattern, normalised, re.IGNORECASE):
            return 'red', what

    upper = normalised.upper()
    for prefix in GREEN_PREFIXES:
        if upper.startswith(prefix.upper()):
            return 'green', 'Dex-owned or known-safe key'

    return 'amber', 'general application setting'


# Kept for anything still importing the old name.
WRITE_ALLOWLIST = GREEN_PREFIXES

_HIVE_MAP = {
    'HKEY_LOCAL_MACHINE': None,  # filled at import time
    'HKLM':               None,
    'HKEY_CURRENT_USER':  None,
    'HKCU':               None,
}


def _load_winreg():
    import winreg
    _HIVE_MAP['HKEY_LOCAL_MACHINE'] = winreg.HKEY_LOCAL_MACHINE
    _HIVE_MAP['HKLM']               = winreg.HKEY_LOCAL_MACHINE
    _HIVE_MAP['HKEY_CURRENT_USER']  = winreg.HKEY_CURRENT_USER
    _HIVE_MAP['HKCU']               = winreg.HKEY_CURRENT_USER
    return winreg


def _parse(path: str):
    winreg = _load_winreg()
    parts = path.replace('/', '\\').split('\\', 1)
    hive = _HIVE_MAP.get(parts[0].upper())
    if hive is None:
        raise ValueError(f'Unknown registry hive: {parts[0]}')
    subkey = parts[1] if len(parts) > 1 else ''
    return winreg, hive, subkey


class RegistryHandler:

    @staticmethod
    def read(params: dict) -> dict:
        path = params.get('path', '')
        name = params.get('name', '')
        winreg, hive, subkey = _parse(path)
        try:
            with winreg.OpenKey(hive, subkey) as key:
                value, reg_type = winreg.QueryValueEx(key, name)
                return {'value': value, 'type': reg_type}
        except FileNotFoundError:
            raise ValueError(f'Not found: {path}\\{name}')

    @staticmethod
    def classify(params: dict) -> dict:
        """Lets the core ask which band a path falls in before planning a write."""
        band, reason = classify_write(params.get('path', ''))
        return {'band': band, 'reason': reason}

    @staticmethod
    def write(params: dict) -> dict:
        path = params.get('path', '')
        name = params.get('name', '')
        value = params.get('value')

        band, reason = classify_write(path)

        if band == 'red':
            # Deliberately unconditional — Full Access does not reach this line.
            raise PermissionError(
                f'Refused: {path} controls {reason}. Dex never changes Windows '
                'security or policy settings, including in Full Access mode.'
            )

        full_access = os.environ.get('DEX_FULL_ACCESS', '').lower() == 'true'
        if band == 'amber' and not full_access:
            # The Brain marks these Tier 2 so the owner sees a card first. One
            # arriving here unconfirmed means the confirmation was skipped.
            raise PermissionError(
                f'{path} is a general registry key ({reason}) and needs owner '
                'confirmation. Plan this step as Tier 2, or enable Full Access.'
            )

        winreg, hive, subkey = _parse(path)
        reg_type = params.get('type', winreg.REG_SZ)

        # Create the key if it is missing, but only in the GREEN band. Dex is
        # allowed to make its own keys -- HKCU\Software\DEX does not exist on a
        # fresh machine, and OpenKey alone meant Dex could not write to the one
        # tree it unambiguously owns. It is not allowed to invent new keys
        # inside somebody else's tree, so AMBER still has to find what it edits.
        opener = winreg.CreateKeyEx if band == 'green' else winreg.OpenKey
        with opener(hive, subkey, 0, winreg.KEY_WRITE) as key:
            winreg.SetValueEx(key, name, 0, reg_type, value)

        log.info('Registry write [%s]: %s\\%s = %r', band, path, name, value)

        # Read back. A write that returns cleanly is not proof the value stuck.
        with winreg.OpenKey(hive, subkey) as key:
            stored, _ = winreg.QueryValueEx(key, name)

        return {
            'path': path,
            'name': name,
            'value': value,
            'band': band,
            'read_back': stored,
            'verified': stored == value,
        }
