"""
Launching and closing applications — Tier 1.

The vision tier has an `open_app` action that presses keys at the Start menu.
That is three model calls and a race with however long the menu takes to render,
to do something the OS exposes directly. This replaces it.

SAFETY.md is explicit that Dex must never use Windows-key shortcuts and never
drive a terminal through its GUI. Both rules are structurally satisfied here:
nothing is typed anywhere, and a terminal is refused outright.
"""
from __future__ import annotations

import logging
import os
import subprocess
import time

log = logging.getLogger('AppHandler')

# Shells and terminals. SAFETY.md: system work goes through typed handlers, not
# through a GUI terminal an agent types into.
REFUSED = {
    'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
    'windowsterminal', 'wt', 'wt.exe', 'conhost', 'conhost.exe', 'bash', 'bash.exe',
}

# Friendly names the owner actually says -> what Windows needs to start them.
KNOWN = {
    'notepad': 'notepad.exe',
    'calculator': 'calc.exe',
    'calc': 'calc.exe',
    'paint': 'mspaint.exe',
    'explorer': 'explorer.exe',
    'file explorer': 'explorer.exe',
    'settings': 'ms-settings:',
    'task manager': 'taskmgr.exe',
    'wordpad': 'write.exe',
    'snipping tool': 'ms-screenclip:',
    'control panel': 'control.exe',
}


class AppHandler:

    @staticmethod
    def launch_app(params: dict) -> dict:
        raw = (params.get('name') or '').strip()
        if not raw:
            raise ValueError('launch_app needs a name')

        key = raw.lower()
        base = os.path.basename(key)
        if key in REFUSED or base in REFUSED:
            raise PermissionError(
                f'Dex does not open terminals ("{raw}"). '
                'System work goes through the daemon, not a shell window.'
            )

        target = KNOWN.get(key, raw)

        if target.endswith(':') or '://' in target:
            # Shell protocol (ms-settings:) — start via the shell association.
            os.startfile(target)  # noqa: S606
        else:
            subprocess.Popen(
                target, shell=False,
                creationflags=getattr(subprocess, 'DETACHED_PROCESS', 0),
            )

        # Give the window a moment to exist so a following Tier 2 step finds it
        # rather than racing the launch.
        time.sleep(float(params.get('settle', 1.2)))
        log.info('Launched %s (from %r)', target, raw)
        return {'launched': target, 'requested': raw}

    @staticmethod
    def close_app(params: dict) -> dict:
        """
        Asks the application to close. Never a force-kill — unsaved work stays
        the owner's to decide about.

        Two routes, because Windows has two kinds of app. A classic desktop
        program can be closed by image name. A packaged (UWP) one cannot: its
        launcher is a stub that exits immediately, so `calc.exe` is not running
        even while Calculator is on screen — the real process is CalculatorApp,
        hosted by ApplicationFrameHost. Killing the host would take every other
        packaged app down with it, so those are closed by posting WM_CLOSE to
        the specific window instead.
        """
        name = (params.get('name') or '').strip()
        if not name:
            raise ValueError('close_app needs a name')

        image = KNOWN.get(name.lower(), name)
        if not image.lower().endswith('.exe') and ':' not in image:
            image = f'{image}.exe'

        if _process_running(image):
            result = subprocess.run(
                ['taskkill', '/IM', image],   # no /F: a request, not a kill
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0:
                return {'closed': image, 'method': 'taskkill', 'graceful': True}

        # Several things the window might be called. A packaged app is launched
        # through a stub, so the name that started it ("calc.exe") is rarely the
        # name on the window ("Calculator").
        for candidate in _title_candidates(name, image):
            closed = _close_windows_titled(candidate)
            if closed:
                return {'closed': closed, 'method': 'WM_CLOSE', 'graceful': True}

        raise RuntimeError(
            f'Nothing to close for "{name}" — no process named {image}, '
            f'and no window titled any of {_title_candidates(name, image)}'
        )


def _title_candidates(name: str, image: str) -> list:
    """Names a window might carry, most specific first, de-duplicated."""
    friendly = [k for k, v in KNOWN.items() if v.lower() == image.lower()]
    options = [name, name.removesuffix('.exe'), image.removesuffix('.exe'), *friendly]

    seen, out = set(), []
    for option in options:
        cleaned = option.strip()
        if cleaned and cleaned.lower() not in seen:
            seen.add(cleaned.lower())
            out.append(cleaned)
    return out


def _process_running(image: str) -> bool:
    listing = subprocess.run(
        ['tasklist', '/fi', f'IMAGENAME eq {image}', '/fo', 'csv', '/nh'],
        capture_output=True, text=True, timeout=15,
    ).stdout
    return image.lower() in listing.lower()


def _close_windows_titled(name: str) -> list:
    """
    Post WM_CLOSE to top-level windows belonging to this application.

    Matching is exact, prefix, or suffix — never a bare substring. Windows title
    bars follow "Document - AppName", so the suffix rule is what finds them,
    while a substring rule would let a short candidate like "calc" close
    whatever unrelated window happened to contain those letters. Closing the
    wrong window is not recoverable by retrying.
    """
    try:
        import win32con
        import win32gui
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError('close_app needs pywin32 for packaged apps') from exc

    needle = name.lower().strip()
    closed = []

    def belongs_to_app(title: str) -> bool:
        lowered = title.lower().strip()
        return (
            lowered == needle
            or lowered.endswith(f' - {needle}')
            or lowered.endswith(f'- {needle}')
            or lowered.startswith(needle)
        )

    def visit(hwnd, _):
        if not win32gui.IsWindowVisible(hwnd):
            return
        text = win32gui.GetWindowText(hwnd) or ''
        if text and belongs_to_app(text):
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            closed.append(text)

    win32gui.EnumWindows(visit, None)
    if closed:
        time.sleep(0.6)
    return closed
