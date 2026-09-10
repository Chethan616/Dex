"""
Coverage for InstagramAdapter's download-intent detection — the bug this
exists for: "download the media of the latest Instagram post" was treated
identically to "show me the latest Instagram post" (both just opened,
verified, and screenshotted the post), so download_media() was never
actually called. A chained plan step referencing
{{step_1.output.downloads[0].path}} then failed instantly on an empty
downloads[], with no indication why.

This tests the classification regex directly rather than the full adapter
(which needs a real/mocked Playwright page, manager, and verifier) — the
fix is entirely in which branch a task string falls into.

Usage:
    python tests/test_instagram_download_intent.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# The exact pattern added to instagram_adapter.py — kept in sync by hand;
# if this test ever drifts from the real one, that is itself worth catching.
DOWNLOAD_PATTERN = (
    r"\b(?:download|save)\b.*\b(?:media|image|photo|picture|video|reel|post)\b"
    r"|\b(?:media|image|photo|picture|video|reel)\b.*\bdownload\b"
)

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


def wants_download(task: str) -> bool:
    return bool(re.search(DOWNLOAD_PATTERN, task, re.IGNORECASE))


def check_download_phrasings_are_detected() -> None:
    print("\n\x1b[1m1. Real download phrasings are detected\x1b[0m")
    cases = [
        "download the media (image or video) of the latest Instagram post from https://www.instagram.com/virat.kohli/",
        "Download Virat Kohli's latest Instagram photo",
        "save the video from mrbeast's latest post",
        "please download the image of this reel",
    ]
    for task in cases:
        check(f"detected: {task[:60]!r}...", wants_download(task), task)


def check_view_only_phrasings_are_not_detected() -> None:
    print("\n\x1b[1m2. View-only phrasings are NOT treated as a download request\x1b[0m")
    cases = [
        "show mrbeasts latest post from instagram",
        "get virat kohli's latest instagram post",
        "show virat kohli's latest instagram post",
        "open instagram and show me the latest post",
        "what is the caption on the latest post",
    ]
    for task in cases:
        check(f"not detected: {task[:60]!r}", not wants_download(task), task)


def check_negative_constraint_still_suppresses_download() -> None:
    print("\n\x1b[1m3. An explicit \"don't download\" constraint is honored by the caller\x1b[0m")
    # The adapter ANDs this pattern with `not has_negative_constraint` (a
    # separate, pre-existing check for "do not/don't/never/without" — this
    # only confirms the download phrase itself is still recognized so the
    # negative-constraint AND has something real to suppress.
    task = "don't download the media, just show me the latest post"
    check("the download phrase is still recognized on its own", wants_download(task), task)


def main() -> int:
    print("\x1b[1m=== Instagram Adapter Download-Intent Regression Suite ===\x1b[0m")
    check_download_phrasings_are_detected()
    check_view_only_phrasings_are_not_detected()
    check_negative_constraint_still_suppresses_download()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
