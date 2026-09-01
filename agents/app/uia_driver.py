"""
Tier 2 — controlling Windows applications through UI Automation.

The middle rung of Dex's execution ladder. Tier 1 (the daemon) talks to the OS
directly and never touches a window. Tier 3 takes a screenshot, asks a model
where the button is, and moves the mouse there. This sits between them: it asks
Windows itself what the window contains and invokes the control **by name**.

Why that matters:
  * Deterministic. "Click Save" resolves through the accessibility tree, not a
    pixel guess. It cannot land 30px off and hit Delete.
  * Verifiable. After acting, the same tree can be read back — the strongest
    evidence in the system, and stronger than "the file exists".
  * Free. No GPU, no tokens, no model. Most Windows apps need nothing more.

What it cannot do is the honest boundary: apps that draw their own UI (games,
canvases, image editors) expose no tree. Those raise NotActionable, and the
Orchestrator escalates that step to Tier 3 rather than failing the task.

Every entry point runs inside UIAutomationInitializerInThread() because UIA is
COM/STA and the FastAPI server answers on worker threads.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

import uiautomation as auto

log = logging.getLogger('UiaDriver')

# A window search that blocks for ten seconds makes Dex look hung. Apps that
# are genuinely still launching are handled by wait_for, which is explicit.
FIND_TIMEOUT = 3.0
MAX_DEPTH = 12
MAX_ELEMENTS = 400

# Long enough for an app to act on an invocation, short enough to stay
# imperceptible across a multi-step task. Measured against Calculator, where
# 150ms was reliably sufficient and 0ms was not.
SETTLE_AFTER_INVOKE = 0.15


class WindowNotFound(Exception):
    """No window matched. Recoverable — the app may not be open yet."""


class ElementNotFound(Exception):
    """The window exists but has no such control. Carries near-miss candidates."""

    def __init__(self, message: str, candidates: list[str] | None = None) -> None:
        super().__init__(message)
        self.candidates = candidates or []


class NotActionable(Exception):
    """
    The tree exists but cannot be driven — no usable pattern, or no tree at all.
    This is the signal that a step belongs to the vision tier instead.
    """


class AmbiguousWindow(Exception):
    """
    Several open windows match the title. Refusing here is deliberate: the
    caller is usually about to type into or click inside whichever one is
    picked, and quietly guessing is how an agent overwrites the document
    someone was actually working on.
    """

    def __init__(self, message: str, titles: list[str]) -> None:
        super().__init__(message)
        self.titles = titles


class SecretField(Exception):
    """A password or protected field. SAFETY.md: Dex never types into these."""


@dataclass
class Element:
    name: str
    control_type: str
    automation_id: str
    class_name: str
    enabled: bool
    rect: dict[str, int] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            'name': self.name,
            'control_type': self.control_type,
            'automation_id': self.automation_id,
            'class_name': self.class_name,
            'enabled': self.enabled,
            'rect': self.rect,
        }


def in_com(fn: Callable[[], Any]) -> Any:
    """Run a UIA operation with COM initialised for this thread."""
    with auto.UIAutomationInitializerInThread():
        return fn()


def settled(fn: Callable[[], Any]) -> Any:
    """
    Run a UIA action, then let the application actually process it.

    Invoke() returns once the call is delivered, not once the application has
    acted on it, so a read taken immediately afterwards can catch the previous
    value or a half-updated one. The pause is short enough to be imperceptible
    across a multi-step task and long enough to make reads trustworthy, which
    is what verification depends on.

    Placed outside the COM block simply so the apartment is not held open
    longer than the call needs it.
    """
    result = in_com(fn)
    time.sleep(SETTLE_AFTER_INVOKE)
    return result


# -- discovery ----------------------------------------------------------------


def _rect_of(control: Any) -> dict[str, int]:
    try:
        r = control.BoundingRectangle
        return {'l': r.left, 't': r.top, 'r': r.right, 'b': r.bottom}
    except Exception:  # noqa: BLE001
        return {}


def _describe(control: Any) -> Element:
    return Element(
        name=getattr(control, 'Name', '') or '',
        control_type=getattr(control, 'ControlTypeName', '') or '',
        automation_id=getattr(control, 'AutomationId', '') or '',
        class_name=getattr(control, 'ClassName', '') or '',
        enabled=bool(getattr(control, 'IsEnabled', True)),
        rect=_rect_of(control),
    )


def _find_window(title_contains: str, timeout: float = FIND_TIMEOUT) -> Any:
    """
    Resolve a window title to exactly one window.

    An exact title wins outright. Otherwise a single substring match is used,
    and *several* matches raise rather than picking one — see AmbiguousWindow.
    "Notepad" matching both a scratch window and the document someone has been
    writing in all afternoon is not a hypothetical.
    """
    needle = (title_contains or '').lower().strip()
    deadline = time.time() + timeout

    while True:
        exact: list[Any] = []
        loose: list[Any] = []
        try:
            for win in auto.GetRootControl().GetChildren():
                name = (getattr(win, 'Name', '') or '').strip()
                if not name:
                    continue
                lowered = name.lower()
                if lowered == needle:
                    exact.append(win)
                elif not needle or needle in lowered:
                    loose.append(win)
        except Exception as exc:  # noqa: BLE001
            log.warning('window enumeration failed: %s', exc)

        if exact:
            return exact[-1]

        if len(loose) == 1:
            return loose[0]

        if len(loose) > 1:
            titles = [(getattr(w, 'Name', '') or '').strip() for w in loose]
            raise AmbiguousWindow(
                f'{len(loose)} open windows match "{title_contains}". '
                'Name the one you mean exactly.',
                titles,
            )

        if time.time() >= deadline:
            raise WindowNotFound(f'No open window whose title contains "{title_contains}"')
        time.sleep(0.25)


def _walk(root: Any, limit: int = MAX_ELEMENTS, max_depth: int = MAX_DEPTH):
    """Breadth-first so shallow, visible controls are found before deep ones."""
    queue = [(root, 0)]
    seen = 0
    while queue and seen < limit:
        control, depth = queue.pop(0)
        yield control, depth
        seen += 1
        if depth >= max_depth:
            continue
        try:
            queue.extend((child, depth + 1) for child in control.GetChildren())
        except Exception:  # noqa: BLE001
            continue


# Characters Windows renders that nobody types, mapped to what a person would
# write instead.
#
# This exists because of a failure that read as a Dex bug and was really a
# typography one. Asked to set the display to 1080p, the planner produced
# `1920 x 1080` and Settings offers `1920 × 1080` — U+00D7 MULTIPLICATION SIGN,
# not the letter x. The names look identical on screen, compared unequal, and
# the step failed against a control that was right there in the list Dex had
# already printed.
#
# The same class of thing bites elsewhere: Edge puts a zero-width space in its
# own window title, and Windows uses real en-dashes and curly quotes in labels.
# Anything that looks like plain text to a reader is treated as plain text here.
_TYPOGRAPHY = {
    '×': 'x',        # × multiplication sign — display resolutions
    '–': '-',        # – en dash
    '—': '-',        # — em dash
    '‐': '-',        # ‐ hyphen
    '‑': '-',        # ‑ non-breaking hyphen
    '‘': "'",        # ' left single quote
    '’': "'",        # ' right single quote
    '“': '"',        # " left double quote
    '”': '"',        # " right double quote
    ' ': ' ',        # non-breaking space
    ' ': ' ',        # figure space
    ' ': ' ',        # narrow no-break space
    '​': '',         # zero-width space
    '‌': '',         # zero-width non-joiner
    '‍': '',         # zero-width joiner
    '﻿': '',         # BOM / zero-width no-break space
}

_TYPOGRAPHY_TABLE = str.maketrans(_TYPOGRAPHY)


def _norm(text: str) -> str:
    # Windows puts accelerators in labels: "&Save", "Save (Ctrl+S)".
    #
    # The trailing-parenthesis strip is also what lets a planner's invented
    # "(Recommended)" suffix match the real "1920 × 1080" — it guesses that
    # from the phrase "1080p" without having seen the list, and the real
    # "(Recommended)" is on a different entry entirely.
    text = re.sub(r'\s*\(.*?\)\s*$', '', text or '')
    text = text.translate(_TYPOGRAPHY_TABLE)
    # Collapse whitespace so "1920  ×  1080" and "1920 x 1080" agree.
    text = re.sub(r'\s+', ' ', text)
    return text.replace('&', '').strip().lower()


def _match(control: Any, name: str, control_type: str | None) -> bool:
    if control_type:
        actual = (getattr(control, 'ControlTypeName', '') or '').lower()
        if control_type.lower() not in actual:
            return False

    target = _norm(name)
    visible_name = _norm(getattr(control, 'Name', '') or '')

    # A visible accessible name is the user-facing identity of a control.
    # AutomationId is only a fallback for controls that do not expose a name;
    # Windows pages sometimes reuse an id for a different card or link than
    # the one currently visible. Matching both fields equally caused a request
    # for "System" to invoke a Network card whose visible name was
    # "G-VTT Connected, open".
    candidate = visible_name or (
        getattr(control, 'AutomationId', '') or ''
    ).strip().lower()
    if not candidate:
        return False

    # Exact first, then prefix — "Save" must not match "Save As" when both
    # exist. A whole-word match also handles labels such as "Power & battery"
    # when the planner calls the destination simply "Battery".
    if candidate == target or candidate.startswith(target):
        return True
    target_words = re.findall(r'[a-z0-9]+', target)
    candidate_words = re.findall(r'[a-z0-9]+', candidate)
    return len(target_words) == 1 and target_words[0] in candidate_words


def _find_element(window: Any, name: str, control_type: str | None = None) -> Any:
    controls = list(_walk(window))
    seen_names: list[str] = []
    for control, _ in controls:
        label = getattr(control, 'Name', '') or ''
        if label:
            seen_names.append(label)

    def collect(type_filter: str | None) -> tuple[list[Any], list[Any]]:
        exact: list[Any] = []
        loose: list[Any] = []
        for control, _ in controls:
            label = getattr(control, 'Name', '') or ''
            if _match(control, name, type_filter):
                (exact if _norm(label) == _norm(name) else loose).append(control)
        return exact, loose

    exact, loose = collect(control_type)
    type_fallback = False

    # Windows frequently exposes a navigation item as ListItemControl even
    # when the planner reasonably described it as a button. The accessible
    # name is still precise, so if the type hint found nothing, retry by name
    # rather than failing or accepting an unrelated AutomationId match.
    if control_type and not any(
        getattr(control, 'IsEnabled', True) for control in (*exact, *loose)
    ):
        exact, loose = collect(None)
        type_fallback = True

    def fallback_score(control: Any) -> int:
        """Prefer a visible, focusable action over a duplicate wrapper node."""
        score = 0
        if bool(getattr(control, 'IsKeyboardFocusable', False)):
            score += 4
        try:
            rect = control.BoundingRectangle
            if rect.right > rect.left and rect.bottom > rect.top:
                score += 2
        except Exception:  # noqa: BLE001
            pass
        control_name = (getattr(control, 'ControlTypeName', '') or '').lower()
        if 'text' not in control_name and 'menubar' not in control_name:
            score += 1
        return score

    for pool in (exact, loose):
        enabled = [
            control for control in pool if getattr(control, 'IsEnabled', True)
        ]
        if enabled:
            if type_fallback:
                return max(enabled, key=fallback_score)
            return enabled[0]
        if pool:
            raise ElementNotFound(f'"{name}" exists but is disabled', seen_names[:25])

    if not seen_names:
        # A window with no named controls at all is a canvas — vision territory.
        raise NotActionable(
            'This window exposes no accessible controls (custom-drawn UI)'
        )

    raise ElementNotFound(
        f'No control named "{name}" in this window', sorted(set(seen_names))[:25]
    )


# -- public operations --------------------------------------------------------


def list_elements(window_title: str, control_type: str | None = None) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        named = 0
        found = []
        for control, depth in _walk(window):
            element = _describe(control)
            if not element.name:
                continue
            named += 1
            if control_type and control_type.lower() not in element.control_type.lower():
                continue
            found.append({**element.as_dict(), 'depth': depth})

        # An empty *filtered* result means the filter was wrong, not that the
        # window is unreachable. Conflating the two escalates a perfectly
        # drivable app to the vision tier for no reason — which is exactly what
        # happened with Notepad, whose editor is a DocumentControl rather than
        # the EditControl anyone would guess.
        if named == 0:
            raise NotActionable('This window exposes no accessible controls (custom-drawn UI)')

        return {
            'window': getattr(window, 'Name', ''),
            'elements': found,
            'total_named': named,
        }

    return in_com(run)


def click_element(
    window_title: str, name: str, control_type: str | None = None
) -> dict[str, Any]:
    """
    Invoke by pattern, never by coordinates.

    Three fallbacks in descending order of trustworthiness: InvokePattern is
    what the control itself declares; LegacyIAccessible is the older bridge many
    WinForms controls still use; Click() is a real mouse move and is the last
    resort — it is the only one that can be stolen by another window.
    """
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        control = _find_element(window, name, control_type)
        element = _describe(control)

        try:
            pattern = control.GetPattern(auto.PatternId.InvokePattern)
            if pattern:
                pattern.Invoke()
                return {'method': 'InvokePattern', 'element': element.as_dict()}
        except Exception:  # noqa: BLE001
            pass

        try:
            legacy = control.GetLegacyIAccessiblePattern()
            if legacy:
                legacy.DoDefaultAction()
                return {'method': 'LegacyIAccessible', 'element': element.as_dict()}
        except Exception:  # noqa: BLE001
            pass

        try:
            control.SetFocus()
            control.Click(simulateMove=False)
            return {'method': 'Click', 'element': element.as_dict()}
        except Exception as exc:  # noqa: BLE001
            raise NotActionable(f'"{name}" exposes no way to be activated: {exc}') from exc

    return settled(run)


def set_text(window_title: str, field_name: str, text: str) -> dict[str, Any]:
    """
    Set a field's value atomically through ValuePattern.

    Deliberately not keystrokes. SendKeys goes wherever focus happens to be, so
    a window stealing focus mid-type sprays the text somewhere else — which is
    exactly the failure that put a search query into a browser address bar
    earlier in this project. ValuePattern writes to the control or fails.
    """
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        control = _find_element(window, field_name)

        if bool(getattr(control, 'IsPassword', False)):
            raise SecretField(
                f'"{field_name}" is a password field — Dex does not type secrets'
            )

        try:
            pattern = control.GetPattern(auto.PatternId.ValuePattern)
        except Exception:  # noqa: BLE001
            pattern = None

        if not pattern:
            raise NotActionable(f'"{field_name}" is not a text field Dex can set')
        if getattr(pattern, 'IsReadOnly', False):
            raise NotActionable(f'"{field_name}" is read-only')

        control.SetFocus()
        pattern.SetValue(text)

        # Read back here, not later: this is the moment the truth is knowable,
        # and the Reliability Layer gets a fact instead of an assurance.
        written = ''
        try:
            written = pattern.Value or ''
        except Exception:  # noqa: BLE001
            pass

        return {
            'element': _describe(control).as_dict(),
            'wrote': text,
            'read_back': written,
            'verified': written == text,
        }

    return in_com(run)


def read_element(window_title: str, name: str) -> dict[str, Any]:
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        control = _find_element(window, name)
        element = _describe(control)
        if bool(getattr(control, 'IsPassword', False)):
            return {
                'element': element.as_dict(),
                'value': None,
                'redacted': True,
            }
        value = ''
        try:
            pattern = control.GetPattern(auto.PatternId.ValuePattern)
            if pattern:
                value = pattern.Value or ''
        except Exception:  # noqa: BLE001
            pass
        return {'element': element.as_dict(), 'value': value}

    return in_com(run)


def toggle(window_title: str, name: str, on: bool) -> dict[str, Any]:
    """Checkboxes and switches. Reads state first so it never flips it wrong."""
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        control = _find_element(window, name)
        try:
            pattern = control.GetPattern(auto.PatternId.TogglePattern)
        except Exception:  # noqa: BLE001
            pattern = None
        if not pattern:
            raise NotActionable(f'"{name}" is not toggleable')

        current = pattern.ToggleState == auto.ToggleState.On
        if current != on:
            pattern.Toggle()
        after = pattern.ToggleState == auto.ToggleState.On
        return {'was': current, 'now': after, 'verified': after == on}

    return settled(run)


def select_menu(window_title: str, path: list[str]) -> dict[str, Any]:
    """Walk a menu path such as ["File", "Save As"], expanding as it goes."""
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        window.SetFocus()
        taken: list[str] = []

        for label in path:
            control = _find_element(window, label)
            try:
                expand = control.GetPattern(auto.PatternId.ExpandCollapsePattern)
            except Exception:  # noqa: BLE001
                expand = None

            if expand:
                expand.Expand()
            else:
                try:
                    control.GetPattern(auto.PatternId.InvokePattern).Invoke()
                except Exception:  # noqa: BLE001
                    control.Click(simulateMove=False)
            taken.append(label)
            # Menus render asynchronously; the next item does not exist yet.
            time.sleep(0.35)

        return {'path': taken}

    return in_com(run)


def wait_for(window_title: str, name: str, timeout: float = 10.0) -> dict[str, Any]:
    """Deterministic synchronisation — the alternative is a guessed sleep()."""
    def run() -> dict[str, Any]:
        deadline = time.time() + timeout
        last = 'not found'
        while time.time() < deadline:
            try:
                window = _find_window(window_title, timeout=0.5)
                control = _find_element(window, name)
                return {'appeared': True, 'element': _describe(control).as_dict()}
            except (WindowNotFound, ElementNotFound) as exc:
                last = str(exc)
                time.sleep(0.4)
        return {'appeared': False, 'reason': last}

    return in_com(run)


def window_state(window_title: str) -> dict[str, Any]:
    """Snapshot for the Reliability Layer's before/after comparison."""
    def run() -> dict[str, Any]:
        window = _find_window(window_title)
        names = []
        for control, _ in _walk(window, limit=200):
            label = getattr(control, 'Name', '') or ''
            if label:
                names.append(label)
        return {
            'window': getattr(window, 'Name', ''),
            'element_count': len(names),
            'elements': sorted(set(names))[:120],
        }

    return in_com(run)
