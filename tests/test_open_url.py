"""
Coverage for AppHandler.open_url — the "open X" half of the browser-use
redesign. This must be exactly os.startfile(url): no Playwright, no CDP,
no DEX browser profile, nothing to verify. It is the same category of
action as double-clicking a link, deliberately kept that simple so "open
instagram" never has to mean "automate a browser."

Usage:
    python tests/test_open_url.py
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from daemon.handlers.app_handler import AppHandler

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


def check_calls_startfile_with_the_exact_url() -> None:
    print("\n\x1b[1m1. A full URL is passed straight to os.startfile\x1b[0m")
    with patch("daemon.handlers.app_handler.os.startfile") as startfile:
        result = AppHandler.open_url({"url": "https://www.instagram.com"})
    startfile.assert_called_once_with("https://www.instagram.com")
    check("returns the resolved url", result["url"] == "https://www.instagram.com", result)


def check_bare_hostname_gets_a_scheme() -> None:
    print("\n\x1b[1m2. A bare hostname (no scheme) gets https:// added\x1b[0m")
    with patch("daemon.handlers.app_handler.os.startfile") as startfile:
        result = AppHandler.open_url({"url": "instagram.com"})
    startfile.assert_called_once_with("https://instagram.com")
    check("returns the scheme-qualified url", result["url"] == "https://instagram.com", result)


def check_missing_url_is_rejected() -> None:
    print("\n\x1b[1m3. No url at all is rejected before touching the system\x1b[0m")
    with patch("daemon.handlers.app_handler.os.startfile") as startfile:
        try:
            AppHandler.open_url({})
            check("raised ValueError", False, "did not raise")
        except ValueError:
            check("raised ValueError", True)
    check("os.startfile was never called", not startfile.called)


def check_no_browser_automation_module_is_touched() -> None:
    print("\n\x1b[1m4. No browser-automation call appears in open_url's actual code\x1b[0m")
    import ast
    import inspect
    import textwrap

    source = inspect.getsource(AppHandler.open_url)
    tree = ast.parse(textwrap.dedent(source))
    func = tree.body[0]
    func.body = [stmt for stmt in func.body if not (isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant))]
    code_only = ast.unparse(func)
    forbidden = ["playwright", "connect_over_cdp", "BrowserManager", "SessionManager", "launch_persistent_context"]
    hits = [word for word in forbidden if word.lower() in code_only.lower()]
    check("no Playwright/CDP/BrowserManager/SessionManager call in the executable code", not hits, hits)


def main() -> int:
    print("\x1b[1m=== open_url Regression Suite ===\x1b[0m")
    check_calls_startfile_with_the_exact_url()
    check_bare_hostname_gets_a_scheme()
    check_missing_url_is_rejected()
    check_no_browser_automation_module_is_touched()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
