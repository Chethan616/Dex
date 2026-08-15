"""
Executor: translates abstract actions into real mouse/keyboard events.
Uses pyautogui for input and pywin32 for app launching.
"""
import base64
import ctypes
import io
import logging
import subprocess
import time

import pyautogui
from PIL import Image

log = logging.getLogger('Executor')

# Safety: moving mouse to top-left aborts. Short pause between actions.
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.25


def _dpi_scale() -> float:
    try:
        # SetProcessDpiAwareness(2) = per-monitor DPI aware
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
        return ctypes.windll.shcore.GetScaleFactorForDevice(0) / 100.0
    except Exception:
        return 1.0


class Executor:
    def __init__(self):
        self.dpi = _dpi_scale()
        log.info(f'DPI scale: {self.dpi}x')

    # ── screenshots ──────────────────────────────────────────────────────────

    def screenshot_b64(self) -> str:
        img = pyautogui.screenshot()
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return base64.b64encode(buf.getvalue()).decode('utf-8')

    def screenshot_bytes(self) -> bytes:
        img = pyautogui.screenshot()
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()

    # ── action dispatch ───────────────────────────────────────────────────────

    def execute(self, action: dict, coords: dict | None = None) -> bool:
        atype = action.get('action_type', '')
        try:
            if atype == 'click':
                if not coords:
                    log.error('click: no coordinates from grounding')
                    return False
                pyautogui.click(coords['x'], coords['y'])

            elif atype == 'double_click':
                if not coords:
                    return False
                pyautogui.doubleClick(coords['x'], coords['y'])

            elif atype == 'right_click':
                if not coords:
                    return False
                pyautogui.rightClick(coords['x'], coords['y'])

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
                x = coords['x'] if coords else pyautogui.position()[0]
                y = coords['y'] if coords else pyautogui.position()[1]
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

    # ── helpers ───────────────────────────────────────────────────────────────

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
        subprocess.Popen(['cmd', '/c', 'start', '', cmd], shell=False)
        time.sleep(1.5)
