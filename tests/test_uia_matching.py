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

    print("UIA matching regression checks passed")


if __name__ == "__main__":
    main()
