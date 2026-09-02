"""
Drawing on a canvas with the real mouse.

The counterpart to image_trace: that turns a picture into strokes, this puts
them on screen. Deliberately not part of the vision tier — a stroke does not
need a model to decide where it goes, and a vision loop drawing a picture would
cost a fortune and wander. Everything here is arithmetic.

It is also the only thing in Dex that takes over the pointer for minutes at a
time, which is why the guards are the substance of the file rather than
decoration around it:

  **The window must be in front, checked before every batch.** The pointer is
  a single shared resource. If the owner alt-tabs mid-drawing, the next stroke
  lands in whatever is now in front — a document, a chat window, a game. That
  is not a cosmetic failure, so the drawing stops the moment the target stops
  being frontmost.

  **Every point is clamped into the canvas.** A stroke that escapes the canvas
  is a click-drag across the desktop, which selects, moves or deletes things
  depending on what is under it.

  **Batches, not one long call.** The caller sends a slice at a time so it can
  check whether the owner pressed Stop between them. A single call that draws
  four hundred strokes cannot be interrupted, and this is precisely the
  operation someone watches and then wants to stop.

  **The mouse is put back.** Where the pointer was is the owner's, not Dex's.
"""
from __future__ import annotations

import logging
import time
from typing import Any

log = logging.getLogger('CanvasDriver')

# Names that mean "this is the drawing area", lowercased.
#
# Tried before geometry because a name is a statement of intent and an area is
# a guess. None of these is Paint-specific: they are what canvas controls are
# called across applications.
CANVAS_NAMES = ('canvas', 'drawing', 'image', 'artboard', 'workspace', 'document')

# Keep the pen off the very edge. Paint's canvas has resize handles on its
# bottom and right, and a stroke that starts on one resizes the image instead
# of drawing.
EDGE_MARGIN = 6

# How far the pen moves between samples, in pixels.
#
# A long straight line does not need intermediate points to be drawn correctly,
# but it does need them to be drawn *visibly*: pyautogui moving instantly from
# one end to the other is a jump the application may render as a dot. This is
# also what makes it look like drawing rather than teleporting.
STEP_PIXELS = 14


def find_canvas(window_title: str) -> dict[str, Any]:
    """
    Where the drawing area is, in screen coordinates.

    Three strategies, in descending order of confidence, and the one that was
    used is reported so the caller can say how sure it is.
    """
    import uiautomation as auto

    window = _window(window_title)
    rect = window.BoundingRectangle

    named = _by_name(window, auto)
    if named is not None:
        return _rect(named, 'named')

    largest = _largest_child(window)
    if largest is not None:
        return _rect(largest, 'largest-child')

    # Nothing identifiable. Use the window minus a generous top strip for the
    # toolbar or ribbon, which is where every canvas application puts one.
    top = rect.top + int((rect.bottom - rect.top) * 0.22)
    return {
        'left': rect.left + 8,
        'top': top,
        'right': rect.right - 8,
        'bottom': rect.bottom - 8,
        'method': 'window-estimate',
    }


def draw_strokes(
    window_title: str,
    strokes: list,
    canvas: dict | None = None,
    settle: float = 0.0,
) -> dict[str, Any]:
    """
    Draw one batch of strokes.

    `strokes` carry normalised 0..1 coordinates, so the same trace fits any
    canvas at any size. `canvas` is the rectangle from a previous find_canvas —
    passed back in so a multi-batch drawing measures once and every batch lands
    in the same place, even if the window is nudged.
    """
    import pyautogui
    import uiautomation as auto

    # pyautogui's own guards fight this one. The corner abort would fire on a
    # legitimate stroke near the top-left of a maximised canvas, and the pause
    # between calls would add minutes across a few thousand points.
    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0

    if not strokes:
        return {'drawn': 0, 'points': 0, 'skipped': 0}

    window = _window(window_title)
    area = canvas or find_canvas(window_title)

    if not _is_foreground(window, auto):
        raise RuntimeError(
            f'"{window_title}" is not the window in front. Dex will not draw '
            'into whatever is: the pointer is shared, and a stroke that lands '
            'in the wrong window is not something it can take back.'
        )

    left = area['left'] + EDGE_MARGIN
    top = area['top'] + EDGE_MARGIN
    right = area['right'] - EDGE_MARGIN
    bottom = area['bottom'] - EDGE_MARGIN
    width = max(right - left, 1)
    height = max(bottom - top, 1)

    origin = pyautogui.position()
    drawn = points_drawn = skipped = 0

    try:
        for stroke in strokes:
            raw = stroke.get('points') if isinstance(stroke, dict) else stroke
            mapped = [
                (
                    _clamp(left + float(x) * width, left, right),
                    _clamp(top + float(y) * height, top, bottom),
                )
                for x, y in (raw or [])
            ]
            if len(mapped) < 2:
                skipped += 1
                continue

            _draw_one(pyautogui, mapped)
            drawn += 1
            points_drawn += len(mapped)

            if settle:
                time.sleep(settle)
    finally:
        # Whatever happened, give the pointer back where it was found.
        try:
            pyautogui.moveTo(origin[0], origin[1], duration=0)
        except Exception:  # noqa: BLE001
            pass

    return {
        'drawn': drawn,
        'points': points_drawn,
        'skipped': skipped,
        'canvas': area,
    }


# ---------------------------------------------------------------------------
# internals
# ---------------------------------------------------------------------------

def _draw_one(pyautogui, points: list) -> None:
    """
    One polyline, as a press-drag-release.

    Intermediate samples are inserted along any long segment: the application
    receives mouse-move messages, and two points far apart can arrive as a
    single jump that a canvas renders as a dot rather than a line.
    """
    start = points[0]
    pyautogui.moveTo(start[0], start[1], duration=0)
    pyautogui.mouseDown()
    try:
        previous = start
        for point in points[1:]:
            for sample in _interpolate(previous, point):
                pyautogui.moveTo(sample[0], sample[1], duration=0)
            previous = point
    finally:
        # Never leave the button down. A stuck mouse button is the worst
        # possible way for this to fail: every subsequent click becomes a drag.
        pyautogui.mouseUp()


def _interpolate(a, b) -> list:
    distance = max(abs(b[0] - a[0]), abs(b[1] - a[1]))
    steps = max(1, int(distance // STEP_PIXELS))
    return [
        (a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)
        for i in range(1, steps + 1)
    ]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _window(title: str):
    # Flat import, matching how server.py loads its siblings: these modules are
    # a script directory on sys.path, not a package.
    from uia_driver import _find_window
    return _find_window(title)


def _is_foreground(window, auto) -> bool:
    """
    Whether this window is the one receiving input.

    Compared by native handle rather than by title: two windows can share a
    title, and the one in front is a fact about handles.
    """
    try:
        front = auto.GetForegroundControl()
        return bool(front) and front.NativeWindowHandle == window.NativeWindowHandle
    except Exception:  # noqa: BLE001
        try:
            # A window that cannot be compared is one we should not draw into.
            return bool(window.IsTopmost()) or window.IsKeyboardFocusable
        except Exception:  # noqa: BLE001
            return False


def _by_name(window, auto):
    """A descendant whose name says it is the drawing surface."""
    try:
        for control in window.GetChildren():
            for candidate in (control, *control.GetChildren()):
                name = (candidate.Name or '').lower()
                if any(word in name for word in CANVAS_NAMES) and _area(candidate) > 10_000:
                    return candidate
    except Exception:  # noqa: BLE001
        pass
    return None


def _largest_child(window):
    """
    The biggest thing inside the window.

    A canvas application is mostly canvas, so the largest descendant that is
    not the window itself is almost always it. Only two levels are walked:
    deeper than that and the biggest element is a scroll container's inner
    surface, which is smaller than the visible area rather than larger.
    """
    best, best_area = None, 0
    try:
        for control in window.GetChildren():
            for candidate in (control, *control.GetChildren()):
                area = _area(candidate)
                if area > best_area:
                    best, best_area = candidate, area
    except Exception:  # noqa: BLE001
        return None

    # Below about a fifth of the window it is a panel, not the canvas.
    return best if best_area > _area(window) * 0.2 else None


def _area(control) -> int:
    try:
        rect = control.BoundingRectangle
        return max(0, rect.right - rect.left) * max(0, rect.bottom - rect.top)
    except Exception:  # noqa: BLE001
        return 0


def _rect(control, method: str) -> dict[str, Any]:
    rect = control.BoundingRectangle
    return {
        'left': rect.left,
        'top': rect.top,
        'right': rect.right,
        'bottom': rect.bottom,
        'method': method,
        'element': control.Name or control.ControlTypeName,
    }
