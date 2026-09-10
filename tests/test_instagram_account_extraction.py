"""
Coverage for InstagramAdapter.extract_instagram_account — the bug this
covers: "Go to Instagram, navigate to KSI's profile, find the latest post,
and send it to Veeravardhan via direct message" (a planner rewrite of
"send the latest post from ksi to veeravardhan") extracted NO account at
all, because every existing pattern needed the possessive and "latest
post" adjacent ("KSI's latest post") or the word "instagram"/"insta"
directly before "profile" ("KSI's instagram profile") — this phrasing has
neither, so the adapter raised AdapterFallbackException immediately and
the generic loop was left blindly scrolling instagram.com's homepage with
nothing to search for.

Usage:
    python tests/test_instagram_account_extraction.py
"""
from __future__ import annotations

import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "agents" / "browser"))

from adapters.instagram_adapter import extract_instagram_account

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


def check_planner_rewrite_with_separated_clauses() -> None:
    print("\n\x1b[1m1. The exact live failure: account and 'latest post' separated by other words\x1b[0m")
    task = (
        "Go to Instagram, navigate to KSI's profile, find the latest post, "
        "and send it to Veeravardhan via direct message"
    )
    check("extracts 'ksi', not None", extract_instagram_account(task, None) == "ksi")


def check_existing_patterns_still_work() -> None:
    print("\n\x1b[1m2. Previously-working phrasings are unaffected\x1b[0m")
    cases = [
        ("MrBeast's latest Instagram post", "mrbeast"),
        ("mrbeasts latest post", "mrbeast"),
        ("open PewDiePie's Instagram profile", "pewdiepie"),
        ("latest post from @sidemen", "sidemen"),
        ("latest sidemen post", "sidemen"),
    ]
    for task, expected in cases:
        check(f"{task!r} -> {expected!r}", extract_instagram_account(task, None) == expected, task)


def check_bare_profile_pattern_directly() -> None:
    print("\n\x1b[1m3. The new bare 'X's profile' pattern (no 'instagram'/'insta' needed)\x1b[0m")
    cases = [
        ("open KSI's profile and scroll down", "ksi"),
        ("go to veeravardhan's profile", "veeravardhan"),
    ]
    for task, expected in cases:
        check(f"{task!r} -> {expected!r}", extract_instagram_account(task, None) == expected, task)


def check_site_name_never_accepted_as_account() -> None:
    print("\n\x1b[1m4. \"Instagram\"/\"insta\" itself is never mistaken for an account (unchanged safety rule)\x1b[0m")
    cases = [
        "open Instagram's profile page",
        "go to insta's profile",
    ]
    for task in cases:
        check(f"{task!r} -> None, not 'instagram'/'insta'", extract_instagram_account(task, None) is None, task)


def main() -> int:
    print("\x1b[1m=== Instagram Account Extraction Regression Suite ===\x1b[0m")
    check_planner_rewrite_with_separated_clauses()
    check_existing_patterns_still_work()
    check_bare_profile_pattern_directly()
    check_site_name_never_accepted_as_account()
    print(f"\n\x1b[1mSummary: {passed} passed, {failed} failed\x1b[0m")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
