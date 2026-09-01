"""
Environment variables — reading them, and making a change that actually sticks.

Setting one is the part people get wrong, and it fails in a way that looks like
success. `os.environ['PATH'] = ...` changes this process and nothing else, and
`setx` writes the registry but does not tell anybody, so the change is invisible
to every program already running and to any shell opened from Explorer until the
next sign-out.

The durable form is: write the registry, then broadcast `WM_SETTINGCHANGE` with
"Environment" so the shell re-reads it. Both halves are needed, which is why
this is a handler rather than a one-line shell-out.

Scope matters too. A user variable is the owner's own and needs no elevation; a
machine variable is under HKLM and needs the elevated daemon. Asking for a
machine variable without elevation is refused with the reason, rather than
failing at a `PermissionError` from winreg that says nothing about which one.
"""
from __future__ import annotations

import ctypes
import logging
import os
import winreg

log = logging.getLogger('EnvHandler')

USER_KEY = 'Environment'
MACHINE_KEY = r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'

HWND_BROADCAST = 0xFFFF
WM_SETTINGCHANGE = 0x001A
SMTO_ABORTIFHUNG = 0x0002

# Variables Dex will not rewrite.
#
# PATH is not here — setting it is use case 6, and a development workspace is
# unusable without it. These are the ones where a well-meant change breaks the
# machine in ways that are hard to trace back: the loader's search order, the
# system root, the shell itself.
PROTECTED = {
    'systemroot', 'windir', 'comspec', 'pathext', 'os', 'processor_architecture',
    'number_of_processors', 'username', 'userprofile', 'allusersprofile',
    'programfiles', 'programfiles(x86)', 'programdata', 'systemdrive',
}


class EnvHandler:

    @staticmethod
    def get_env(params: dict) -> dict:
        """
        Read a variable, or all of them.

        Reports the process value and the stored value separately when they
        differ — which happens constantly, because a variable set after this
        daemon started is in the registry and not in `os.environ`. Showing only
        one of them is how "I set it and it didn't work" starts.
        """
        name = (params.get('name') or '').strip()

        if not name:
            return {
                'user': _read_all(winreg.HKEY_CURRENT_USER, USER_KEY),
                'machine': _read_all(winreg.HKEY_LOCAL_MACHINE, MACHINE_KEY),
            }

        stored_user = _read_one(winreg.HKEY_CURRENT_USER, USER_KEY, name)
        stored_machine = _read_one(winreg.HKEY_LOCAL_MACHINE, MACHINE_KEY, name)
        in_process = os.environ.get(name)

        result = {
            'name': name,
            'value': in_process,
            'user': stored_user,
            'machine': stored_machine,
        }
        if in_process is not None and stored_user is None and stored_machine is None:
            result['note'] = 'set for this session only — not stored anywhere'
        elif in_process != (stored_user or stored_machine):
            result['note'] = (
                'the stored value differs from this session — a program already '
                'running will still see the old one'
            )
        return result

    @staticmethod
    def set_env(params: dict) -> dict:
        """
        Set a variable so it survives a restart and is seen by new programs.

        `append=true` adds to a PATH-like list instead of replacing it, skipping
        the entry if it is already there. Replacing PATH when you meant to add
        to it is the single most destructive thing in this file, and it is one
        forgotten flag away, so appending is a first-class option rather than
        something the caller has to assemble.
        """
        name = (params.get('name') or '').strip()
        if not name:
            raise ValueError('set_env needs a name')
        if name.lower() in PROTECTED:
            raise PermissionError(
                f'Refused: {name} is a Windows variable that other programs '
                'rely on. Changing it can leave the machine unable to start '
                'things. Dex will set PATH and your own variables, not this.'
            )

        value = params.get('value')
        scope = str(params.get('scope', 'user')).lower()
        append = bool(params.get('append', False))

        if scope not in ('user', 'machine'):
            raise ValueError('scope must be "user" or "machine"')

        hive, key_path = (
            (winreg.HKEY_CURRENT_USER, USER_KEY)
            if scope == 'user'
            else (winreg.HKEY_LOCAL_MACHINE, MACHINE_KEY)
        )

        previous = _read_one(hive, key_path, name)

        if value is None:
            _delete(hive, key_path, name)
            _broadcast()
            os.environ.pop(name, None)
            log.info('Removed %s (%s)', name, scope)
            return {'name': name, 'scope': scope, 'removed': True, 'was': previous}

        value = str(value)

        if append:
            existing = [p for p in (previous or '').split(os.pathsep) if p]
            if value in existing:
                return {
                    'name': name, 'scope': scope, 'value': previous,
                    'unchanged': True,
                    'note': f'"{value}" was already there',
                }
            existing.append(value)
            value = os.pathsep.join(existing)

        # REG_EXPAND_SZ for anything holding %VARIABLES%, which PATH usually
        # does. Writing it as a plain string freezes the expansion at today's
        # value and silently breaks it when the referenced variable changes.
        kind = winreg.REG_EXPAND_SZ if '%' in value else winreg.REG_SZ

        try:
            with winreg.CreateKeyEx(hive, key_path, 0, winreg.KEY_SET_VALUE) as key:
                winreg.SetValueEx(key, name, 0, kind, value)
        except PermissionError as exc:
            raise PermissionError(
                f'Cannot write the {scope} variable {name}: this needs the '
                'elevated daemon. Grant Full Access in Settings, or use '
                'scope="user", which needs no elevation.'
            ) from exc

        _broadcast()
        os.environ[name] = value

        log.info('Set %s (%s)', name, scope)
        return {
            'name': name,
            'scope': scope,
            'value': value,
            'was': previous,
            'appended': append,
            'note': 'programs already running keep the old value until restarted',
        }


def _read_one(hive, key_path: str, name: str):
    try:
        with winreg.OpenKey(hive, key_path) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return value
    except OSError:
        return None


def _read_all(hive, key_path: str) -> dict:
    out = {}
    try:
        with winreg.OpenKey(hive, key_path) as key:
            index = 0
            while True:
                try:
                    name, value, _ = winreg.EnumValue(key, index)
                except OSError:
                    break
                out[name] = value
                index += 1
    except OSError:
        pass
    return out


def _delete(hive, key_path: str, name: str) -> None:
    try:
        with winreg.OpenKey(hive, key_path, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, name)
    except FileNotFoundError:
        pass


def _broadcast() -> None:
    """
    Tell Windows the environment changed.

    Without this the registry holds the new value and nothing knows. Explorer
    re-reads on this message, so a shell opened afterwards sees the change;
    without it, the owner has to sign out, and in the meantime Dex looks like it
    did nothing.

    SendMessageTimeout rather than SendMessage: a hung top-level window would
    otherwise block the daemon indefinitely, and this is a courtesy broadcast —
    the registry write has already happened and is what actually persists.
    """
    try:
        ctypes.windll.user32.SendMessageTimeoutW(
            HWND_BROADCAST, WM_SETTINGCHANGE, 0,
            ctypes.c_wchar_p('Environment'),
            SMTO_ABORTIFHUNG, 3000, None,
        )
    except Exception:  # noqa: BLE001 — best effort; the write already succeeded
        log.warning('Could not broadcast the environment change')
