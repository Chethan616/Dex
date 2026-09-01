"""Regression tests for UI Automation control matching.

Run with: python tests/test_uia_matching.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from agents.app.uia_driver import _find_element, _match  # noqa: E402


class Control:
    def __init__(
        self,
        name: str,
        automation_id: str,
        control_type: str = "Button",
        children: list["Control"] | None = None,
    ):
        self.Name = name
        self.AutomationId = automation_id
        self.ControlTypeName = control_type
        self.IsEnabled = True
        self._children = children or []

    def GetChildren(self) -> list["Control"]:
        return self._children


def main() -> None:
    # This is the failure captured in the user's Settings screenshot: the
    # wrong Network card reused the requested page's AutomationId.
    assert not _match(
        Control("G-VTT Connected, open", "System"), "System", "Button"
    )

    # Named controls match by the visible accessible name.
    assert _match(Control("System", "DifferentId"), "System", "Button")

    # AutomationId remains useful as a fallback for unnamed controls.
    assert _match(Control("", "System"), "System", "Button")

    # The real Settings navigation tree calls this a ListItemControl, while
    # the planner may call it a button. A name-only fallback handles that
    # semantic mismatch without allowing the Network card through.
    root = Control(
        "Settings",
        "",
        "Window",
        [
            Control("G-VTT Connected, open", "System", "Button"),
            Control("System", "", "ListItemControl"),
        ],
    )
    assert _find_element(root, "System", "Button").Name == "System"

    # Windows labels the destination "Power & battery" on some versions.
    assert _match(Control("Power & battery", "", "ListItemControl"), "Battery", None)

    # Typography the planner cannot know about.
    #
    # Asked to set 1080p, the planner writes "1920 x 1080". Settings offers
    # "1920 × 1080" -- U+00D7 MULTIPLICATION SIGN, not the letter x. The two
    # look identical on screen and compare unequal, so the step failed against
    # a control that was in the list Dex had just printed in its own error.
    resolution = Control("1920 × 1080", "", "ListItemControl")
    assert _match(resolution, "1920 x 1080", None)

    # ...including with the "(Recommended)" the planner invents from "1080p".
    # In the real dropdown that suffix belongs to 2560 x 1440, not this entry.
    assert _match(resolution, "1920 x 1080 (Recommended)", None)

    # The suffix must not make a wrong entry match a right one.
    assert not _match(Control("1280 × 720", "", "ListItemControl"), "1920 x 1080", None)

    # Same class, different characters: a non-breaking hyphen in "Wi-Fi", and
    # the zero-width space Edge puts in its own labels.
    assert _match(Control("Wi‑Fi", "", "ListItemControl"), "Wi-Fi", None)
    assert _match(Control("Microsoft​ Edge", "", "ListItemControl"), "Microsoft Edge", None)

    # Normalisation must not erase a real distinction. Prefix matching is
    # deliberate -- "Battery" should reach "Power & battery" -- so the rule
    # that protects "Save" from "Save As" lives in _find_element, which prefers
    # an exact name over a loose one. Assert the contract where it is kept.
    both = Control(
        "Editor",
        "",
        "Window",
        [
            Control("Save As", "", "Button"),
            Control("Save", "", "Button"),
        ],
    )
    assert _find_element(both, "Save", "Button").Name == "Save"

    # And the resolution list, end to end, against every entry the real
    # Settings dropdown offered when this failed.
    dropdown = Control(
        "Settings",
        "",
        "Window",
        [
            Control(label, "", "ListItemControl")
            for label in (
                "2560 × 1440 (Recommended)", "1920 × 1200", "1920 × 1080",
                "1680 × 1050", "1600 × 1200", "1600 × 900",
                "1366 × 768", "1280 × 1024", "1280 × 720", "1024 × 768",
            )
        ],
    )
    assert _find_element(dropdown, "1920 x 1080 (Recommended)", None).Name == "1920 × 1080"
    assert _find_element(dropdown, "2560 x 1440", None).Name == "2560 × 1440 (Recommended)"

    print("UIA matching regression checks passed")


if __name__ == "__main__":
    main()
