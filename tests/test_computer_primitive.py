"""
Coverage for agents/desktop/computer.py (Phase B of the vision-first
migration): the one canonical desktop mouse/keyboard/screenshot primitive
that replaces executor.py, absorbing screen_handler.py's path logic and
sharing geometry.py's clamp with canvas_driver.py.

The one NEW behavior this phase adds (not present in the old executor.py at
all): every mouse coordinate is clamped to the real virtual-desktop bounds
before pyautogui ever sees it. That's the thing this suite actually needs to
prove, since it's new; everything else is a refactor of code already proven
by the desktop agent's live smoke tests.

Usage:
    python tests/test_computer_primitive.py
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agents" / "desktop"))

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  \x1b[32m✓\x1b[0m {name}")
    else:
        failed += 1
        print(f"  \x1b[31m✗\x1b[0m {name}" + (f" -- {detail}" if detail else ""))


def make_computer_with_bounds(left, top, right, bottom):
    """A Computer with a fixed, known virtual-screen rect, DPI/win32 mocked out."""
    with patch("computer._dpi_scale", return_value=1.0), \
         patch("computer._virtual_screen_bounds", return_value=(left, top, right, bottom)):
        import computer as computer_module
        import importlib
        importlib.reload(computer_module)
        return computer_module.Computer()


def check_clamping() -> None:
    print("\n\x1b[1m1. Coordinate clamping — the new behavior this phase adds\x1b[0m")
    import computer as computer_module
    import importlib
    importlib.reload(computer_module)

    with patch.object(computer_module, "_dpi_scale", return_value=1.0), \
         patch.object(computer_module, "_virtual_screen_bounds", return_value=(0.0, 0.0, 1920.0, 1080.0)):
        comp = computer_module.Computer()

    check("bounds are stored from the (mocked) virtual screen query", comp._bounds == (0.0, 0.0, 1920.0, 1080.0))

    with patch("pyautogui.click") as mock_click:
        comp.execute({"action_type": "click"}, coords={"x": 5000, "y": -200})
        args, _ = mock_click.call_args
        check("an off-screen-right/top coordinate is clamped before pyautogui.click", args == (1920.0, 0.0), str(args))

    with patch("pyautogui.click") as mock_click:
        comp.execute({"action_type": "click"}, coords={"x": 400, "y": 300})
        args, _ = mock_click.call_args
        check("an in-bounds coordinate passes through unchanged", args == (400, 300), str(args))

    with patch("pyautogui.doubleClick") as mock_dclick:
        comp.execute({"action_type": "double_click"}, coords={"x": -50, "y": 5000})
        args, _ = mock_dclick.call_args
        check("double_click is clamped too", args == (0.0, 1080.0), str(args))

    with patch("pyautogui.rightClick") as mock_rclick:
        comp.execute({"action_type": "right_click"}, coords={"x": 99999, "y": 99999})
        args, _ = mock_rclick.call_args
        check("right_click is clamped too", args == (1920.0, 1080.0), str(args))

    with patch("pyautogui.scroll") as mock_scroll:
        comp.execute({"action_type": "scroll", "scroll_direction": "down", "scroll_amount": 3}, coords={"x": -100, "y": -100})
        _, kwargs = mock_scroll.call_args
        check("scroll's target point is clamped too", (kwargs.get("x"), kwargs.get("y")) == (0.0, 0.0), str(kwargs))


def check_dpi_unchanged() -> None:
    print("\n\x1b[1m2. DPI scaling still applies identically to before\x1b[0m")
    import computer as computer_module

    with patch("ctypes.windll.shcore.SetProcessDpiAwareness", return_value=None), \
         patch("ctypes.windll.shcore.GetScaleFactorForDevice", return_value=150):
        scale = computer_module._dpi_scale()
    check("DPI scale factor is read and divided by 100, as before", scale == 1.5, str(scale))

    with patch("ctypes.windll.shcore.SetProcessDpiAwareness", side_effect=Exception("no shcore")):
        scale2 = computer_module._dpi_scale()
    check("a DPI query failure falls back to 1.0 rather than raising", scale2 == 1.0, str(scale2))


def check_save_screenshot() -> None:
    print("\n\x1b[1m3. save_screenshot — absorbs screen_handler.py's path logic\x1b[0m")
    import computer as computer_module
    import importlib
    importlib.reload(computer_module)

    fake_image = MagicMock()
    fake_image.width = 1920
    fake_image.height = 1080

    with patch.object(computer_module, "_dpi_scale", return_value=1.0), \
         patch.object(computer_module, "_virtual_screen_bounds", return_value=(0.0, 0.0, 1920.0, 1080.0)):
        comp = computer_module.Computer()

    with tempfile.TemporaryDirectory() as tmpdir:
        with patch("pyautogui.screenshot", return_value=fake_image), \
             patch("os.path.getsize", return_value=12345):
            result = comp.save_screenshot(path=tmpdir)

        check("no explicit filename -> a timestamped .png inside the given directory",
              Path(result["path"]).parent == Path(tmpdir) and result["path"].endswith(".png"), result["path"])
        check("result reports width/height/bytes, same shape as screen_handler.py's",
              result["width"] == 1920 and result["height"] == 1080 and result["bytes"] == 12345, str(result))

    with tempfile.TemporaryDirectory() as tmpdir:
        # No suffix is treated as directory-like (matches screen_handler.py's
        # original behavior exactly) — a planner passing a bare folder path
        # gets a generated name inside it, not a PermissionError on the folder.
        explicit = str(Path(tmpdir) / "myshot")
        with patch("pyautogui.screenshot", return_value=fake_image), \
             patch("os.path.getsize", return_value=999):
            result2 = comp.save_screenshot(path=explicit)
        check(
            "a suffixless path is treated as a directory, timestamped name inside it",
            Path(result2["path"]).parent == Path(explicit) and result2["path"].endswith(".png"),
            result2["path"],
        )

        with_suffix = str(Path(tmpdir) / "myshot.jpg")
        with patch("pyautogui.screenshot", return_value=fake_image), \
             patch("os.path.getsize", return_value=999):
            result3 = comp.save_screenshot(path=with_suffix)
        check(
            "a non-.png suffix is corrected to .png",
            result3["path"] == str(Path(tmpdir) / "myshot.png"),
            result3["path"],
        )


def check_unicode_typing() -> None:
    print("\n\x1b[1m4. Unicode text still round-trips through the clipboard path\x1b[0m")
    import computer as computer_module
    import importlib
    importlib.reload(computer_module)

    with patch.object(computer_module, "_dpi_scale", return_value=1.0), \
         patch.object(computer_module, "_virtual_screen_bounds", return_value=(0.0, 0.0, 1920.0, 1080.0)):
        comp = computer_module.Computer()

    fake_win32clipboard = MagicMock()
    with patch.dict(sys.modules, {"win32clipboard": fake_win32clipboard}), \
         patch("pyautogui.hotkey") as mock_hotkey:
        ok = comp.execute({"action_type": "type", "text": "héllo wörld 日本語"})

    check("type action succeeds", ok is True)
    check("clipboard is opened/emptied/set with CF_UNICODETEXT", fake_win32clipboard.SetClipboardText.called)
    set_args = fake_win32clipboard.SetClipboardText.call_args
    check("the exact unicode text is what gets set", set_args[0][0] == "héllo wörld 日本語", str(set_args))
    check("paste is triggered via ctrl+v", mock_hotkey.called and mock_hotkey.call_args[0] == ("ctrl", "v"))


def main() -> int:
    print("\n\x1b[1m=== Computer Primitive Regression Suite ===\x1b[0m")
    check_clamping()
    check_dpi_unchanged()
    check_save_screenshot()
    check_unicode_typing()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
