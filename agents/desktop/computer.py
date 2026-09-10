"""
Computer: the one canonical desktop mouse/keyboard/screenshot primitive.

Was agents/desktop/executor.py, generalized (Phase B of the vision-first
migration). Absorbs:
  - executor.py's Executor class, nearly verbatim (screenshot, click/type/
    key/scroll dispatch, DPI awareness).
  - screen_handler.py's path-resolution logic for save_screenshot (the
    *logic*, not the module — the daemon and this desktop-agent process are
    genuinely different privilege contexts, so daemon/handlers/screen_handler.py
    itself stays where it is and is not imported cross-process).

New in this version: every mouse coordinate is clamped to the real
virtual-desktop bounds before pyautogui ever sees it. This is a correctness
fix, not a policy decision — a badly-grounded coordinate landing off-screen
(or on the wrong monitor because of a DPI-scale bug) is a bug class, the same
one agents/app/canvas_driver.py already guards against for its own narrower
case. That file's per-stroke clamping now shares this module's `geometry`
helpers rather than keeping a second copy.

Not merged here (see the Phase B plan): agents/browser/visual_fallback.py
clicks through Playwright's CDP session — in-browser coordinates, not real
OS mouse events. A fundamentally different thing, retired with the rest of
the browser DOM stack, not folded into a "real desktop" primitive.
"""
from __future__ import annotations

import base64
import ctypes
import io
import logging
import os
import subprocess
import time
from pathlib import Path

import pyautogui
import win32api
import win32con

from geometry import clamp_point

log = logging.getLogger('Computer')

# Safety: moving mouse to top-left aborts. Short pause between actions.
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.25

# Where captures go when the caller does not say — matches
# daemon/handlers/screen_handler.py's DEFAULT_DIR exactly, so a screenshot
# from either path lands where the owner already looks for one.
DEFAULT_SCREENSHOT_DIR = Path.home() / 'Pictures' / 'Dex'


def _dpi_scale() -> float:
    try:
        # SetProcessDpiAwareness(2) = per-monitor DPI aware
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100.0
    except Exception:
        return 1.0


def _virtual_screen_bounds() -> tuple[float, float, float, float]:
    """(left, top, right, bottom) across every monitor, not just the primary."""
    try:
        left = win32api.GetSystemMetrics(win32con.SM_XVIRTUALSCREEN)
        top = win32api.GetSystemMetrics(win32con.SM_YVIRTUALSCREEN)
        width = win32api.GetSystemMetrics(win32con.SM_CXVIRTUALSCREEN)
        height = win32api.GetSystemMetrics(win32con.SM_CYVIRTUALSCREEN)
        return float(left), float(top), float(left + width), float(top + height)
    except Exception:
        # A single-monitor fallback that still clamps to *something* rather
        # than not clamping at all.
        size = pyautogui.size()
        return 0.0, 0.0, float(size.width), float(size.height)


class Computer:
    def __init__(self):
        self.dpi = _dpi_scale()
        self._bounds = _virtual_screen_bounds()
        log.info(f'DPI scale: {self.dpi}x, virtual screen bounds: {self._bounds}')

    # ── screenshots ──────────────────────────────────────────────────────────

    def screenshot_b64(self) -> str:
        return base64.b64encode(self.screenshot_bytes()).decode('utf-8')

    def screenshot_bytes(self, region: tuple[int, int, int, int] | None = None) -> bytes:
        img = self._grab(region)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()

    def save_screenshot(self, path: str | None = None, region: tuple[int, int, int, int] | None = None) -> dict:
        """
        Writes a PNG to `path` (a directory gets a timestamped name inside
        it, same convention as the daemon's screen_handler.py) and returns
        {path, width, height, bytes} — same shape that handler already
        returns, so anything reading its result reads this one identically.
        """
        target = _resolve_screenshot_path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        img = self._grab(region)
        img.save(target, 'PNG')
        size = os.path.getsize(target)
        log.info(f'Captured {img.width}x{img.height} to {target} ({size} bytes)')
        return {'path': str(target), 'width': img.width, 'height': img.height, 'bytes': size}

    def _grab(self, region: tuple[int, int, int, int] | None):
        if region:
            x, y, w, h = region
            return pyautogui.screenshot(region=(x, y, w, h))
        return pyautogui.screenshot()

    # ── action dispatch ───────────────────────────────────────────────────────

    def execute(self, action: dict, coords: dict | None = None) -> bool:
        atype = action.get('action_type', '')
        try:
            if atype == 'click':
                if not coords:
                    log.error('click: no coordinates from grounding')
                    return False
                x, y = self._clamped(coords['x'], coords['y'])
                pyautogui.click(x, y)

            elif atype == 'double_click':
                if not coords:
                    return False
                x, y = self._clamped(coords['x'], coords['y'])
                pyautogui.doubleClick(x, y)

            elif atype == 'right_click':
                if not coords:
                    return False
                x, y = self._clamped(coords['x'], coords['y'])
                pyautogui.rightClick(x, y)

            elif atype == 'type':
                text = action.get('text', '')
                # pyautogui.write doesn't handle unicode well — use clipboard paste
                self._type_text(text)

            elif atype == 'key':
                combo = action.get('key_combo', '').lower()
                keys = [k.strip() for k in combo.replace('+', ',').split(',')]
                if len(keys) == 1:
                    pyautogui.press(keys[0])
                else:
                    pyautogui.hotkey(*keys)

            elif atype == 'scroll':
                if coords:
                    x, y = self._clamped(coords['x'], coords['y'])
                else:
                    x, y = pyautogui.position()
                direction = action.get('scroll_direction', 'down')
                amount = int(action.get('scroll_amount', 3))
                clicks = amount if direction == 'up' else -amount
                pyautogui.scroll(clicks, x=x, y=y)

            elif atype == 'open_app':
                app_name = action.get('app_name', '')
                self._open_app(app_name)

            else:
                log.warning(f'Unhandled action type: {atype}')
                return False

            time.sleep(0.35)
            return True

        except Exception as exc:
            log.error(f'Execute "{atype}" failed: {exc}')
            return False

    def click_point(self, x: float, y: float) -> None:
        """A raw clamped click, for callers (e.g. a future drag/draw action)
        that already have a real screen coordinate rather than a
        target_description needing grounding."""
        cx, cy = self._clamped(x, y)
        pyautogui.click(cx, cy)

    def move_to(self, x: float, y: float) -> None:
        cx, cy = self._clamped(x, y)
        pyautogui.moveTo(cx, cy)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _clamped(self, x: float, y: float) -> tuple[float, float]:
        return clamp_point(x, y, self._bounds)

    def _type_text(self, text: str) -> None:
        """Type text using clipboard to handle unicode and special characters."""
        import win32clipboard
        win32clipboard.OpenClipboard()
        win32clipboard.EmptyClipboard()
        win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
        win32clipboard.CloseClipboard()
        pyautogui.hotkey('ctrl', 'v')

    def _open_app(self, app_name: str) -> None:
        """Open an application by name using Win+R or start command."""
        app_lower = app_name.lower().strip()

        # Known app commands
        known = {
            'notepad': 'notepad.exe',
            'calculator': 'calc.exe',
            'paint': 'mspaint.exe',
            'wordpad': 'wordpad.exe',
            'file explorer': 'explorer.exe',
            'explorer': 'explorer.exe',
            'command prompt': 'cmd.exe',
            'task manager': 'taskmgr.exe',
        }
        cmd = known.get(app_lower, app_name)
        # cmd.exe is a console program and this agent runs under pythonw, which
        # has no console to lend it -- so without the flag Windows creates a
        # new visible one every time Dex opens an application. The application
        # itself still gets its own window; only the shell that launched it is
        # suppressed.
        subprocess.Popen(
            ['cmd', '/c', 'start', '', cmd],
            shell=False,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
        )
        time.sleep(1.5)


def _resolve_screenshot_path(raw: str | None) -> Path:
    if not raw:
        return DEFAULT_SCREENSHOT_DIR / _stamped_name()
    path = Path(str(raw)).expanduser()
    if path.is_dir() or not path.suffix:
        return path / _stamped_name()
    if path.suffix.lower() != '.png':
        path = path.with_suffix('.png')
    return path


def _stamped_name() -> str:
    return time.strftime('dex-%Y%m%d-%H%M%S.png')
