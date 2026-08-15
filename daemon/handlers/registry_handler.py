import logging

log = logging.getLogger('RegistryHandler')

# Only these prefixes may be written without Tier 2 confirmation
WRITE_ALLOWLIST = [
    'HKEY_CURRENT_USER\\Software\\DEX',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\DEX',
]

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
    def write(params: dict) -> dict:
        import os
        path = params.get('path', '')
        name = params.get('name', '')
        value = params.get('value')

        full_access = os.environ.get('DEX_FULL_ACCESS', '').lower() == 'true'
        if not full_access and not any(path.startswith(a) for a in WRITE_ALLOWLIST):
            raise PermissionError(
                f'Registry path not in write allowlist: {path}\n'
                f'Enable Full Access mode to write to arbitrary registry paths.'
            )

        winreg, hive, subkey = _parse(path)
        reg_type = params.get('type', winreg.REG_SZ)
        with winreg.OpenKey(hive, subkey, 0, winreg.KEY_WRITE) as key:
            winreg.SetValueEx(key, name, 0, reg_type, value)

        log.info(f'Registry write: {path}\\{name} = {value!r}')
        return {'path': path, 'name': name, 'value': value}
