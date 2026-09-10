"""
Pure geometry helpers shared by anything that moves the mouse: coordinate
clamping so a computed point can never land outside its intended bounds, and
point interpolation for a smooth drag/stroke path instead of one big jump.

No I/O, no Windows API calls. agents/app/canvas_driver.py and
agents/desktop/computer.py both import this rather than keeping two copies —
extracted from canvas_driver.py's own `_clamp`/`_interpolate`, unchanged in
behavior.
"""
from __future__ import annotations

STEP_PIXELS = 14


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def clamp_point(x: float, y: float, bounds: tuple[float, float, float, float]) -> tuple[float, float]:
    """bounds = (left, top, right, bottom)."""
    left, top, right, bottom = bounds
    return clamp(x, left, right), clamp(y, top, bottom)


def interpolate(
    a: tuple[float, float],
    b: tuple[float, float],
    step_pixels: float = STEP_PIXELS,
) -> list[tuple[float, float]]:
    """Points from just after `a` to `b`, spaced ~step_pixels apart."""
    distance = max(abs(b[0] - a[0]), abs(b[1] - a[1]))
    steps = max(1, int(distance // step_pixels))
    return [
        (a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)
        for i in range(1, steps + 1)
    ]
