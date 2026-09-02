"""
A photograph, turned into strokes a hand could draw.

The request was for Dex to draw a picture in Paint "like an artist", and the
first decision is what that has to mean. Three options were on the table and
only one of them is honest:

  * Generate the image and open it in Paint. Fast, and a lie — nothing was
    drawn.
  * Ask a vision model where to move the mouse, step by step. Thousands of
    calls, minutes of latency per stroke, and it would wander.
  * Work out the outlines here, deterministically, and draw them. No model in
    the path at all, and the result appears stroke by stroke the way a person
    sketching would produce it.

This is the third. What comes out is a **line drawing** — a traced sketch, not
a reproduction of the photograph — and everything downstream says so plainly
rather than implying more.

The pipeline is the classic one, and each stage earns its place:

    greyscale     colour is not information a pen has
    blur          without it every sensor speckle becomes a stroke
    Sobel         gradient magnitude: where the image changes
    threshold     keep the strongest edges; the rest is texture
    thin          a 3-pixel-wide edge should be one line, not three
    walk          follow each ridge into an ordered polyline
    simplify      Douglas-Peucker: a straight run needs two points, not forty
    order         nearest-neighbour, so the pen does not fly across the page

Coordinates come out normalised 0..1, so one trace fits any canvas at any size.
"""
from __future__ import annotations

import logging
import math

log = logging.getLogger('ImageTrace')

# How much detail each setting keeps.
#
# The numbers are edge-strength percentiles, not absolute thresholds: what
# counts as a strong edge depends entirely on the picture, and a fixed
# threshold gives a blank page for a soft portrait and a scribble for a
# high-contrast logo.
DETAIL = {
    'sketch': {'keep': 92.0, 'min_run': 8, 'tolerance': 1.6, 'max_strokes': 260},
    'fine': {'keep': 86.0, 'min_run': 5, 'tolerance': 0.9, 'max_strokes': 900},
}

# The working resolution.
#
# Not the source resolution: a 4000px photo has 4000px of noise, and the pen is
# going to move a few hundred pixels on screen whatever happens. Tracing at
# roughly the size it will be drawn at is both faster and better-looking.
WORK_WIDTH = 520


def trace_image(params: dict) -> dict:
    """
    params:
      path    the reference image
      detail  'sketch' (default) or 'fine'

    Returns { strokes: [{ color, points: [[x, y], ...] }], ... } with every
    coordinate in 0..1.
    """
    import numpy as np
    from PIL import Image, ImageFilter, ImageOps

    source = str(params.get('path', '')).strip()
    if not source:
        raise ValueError('trace_image needs a path')

    detail = str(params.get('detail', 'sketch')).lower()
    if detail not in DETAIL:
        raise ValueError(f'detail must be one of: {", ".join(DETAIL)}')
    settings = DETAIL[detail]

    with Image.open(source) as opened:
        # EXIF orientation, or a phone photo traces on its side.
        image = ImageOps.exif_transpose(opened).convert('L')

    original = image.size
    if image.width > WORK_WIDTH:
        height = max(1, round(image.height * WORK_WIDTH / image.width))
        image = image.resize((WORK_WIDTH, height), Image.LANCZOS)

    # Autocontrast before blurring: a flat, low-contrast photo has real edges,
    # they are just faint, and stretching first finds them.
    image = ImageOps.autocontrast(image, cutoff=1)
    image = image.filter(ImageFilter.GaussianBlur(radius=1.1))

    pixels = np.asarray(image, dtype=np.float32)
    magnitude = _sobel(pixels, np)

    # The percentile is taken over pixels that have a gradient at all, not over
    # the whole image.
    #
    # Over the whole image it describes the background, which dominates
    # everything: a line drawing on white is 97% flat, so the 92nd percentile
    # is zero and the trace comes back empty. A photograph of a sky has the
    # same problem in milder form. What the setting means is "keep the
    # strongest edges", and that is a statement about edges.
    edged = magnitude[magnitude > 0]
    if edged.size == 0:
        # Genuinely flat. Nothing to trace is a real answer.
        return _result([], image.size, original, detail, source)

    threshold = float(np.percentile(edged, settings['keep']))
    if threshold <= 0:
        # Almost flat: a handful of faint gradients and nothing else. Take
        # anything above the noise floor rather than everything.
        threshold = float(magnitude.max()) * 0.25
    if threshold <= 0:
        return _result([], image.size, original, detail, source)

    edges = magnitude >= threshold
    edges = _thin(edges, magnitude, np)

    strokes = _walk(edges, np, settings['min_run'])
    strokes = [_simplify(s, settings['tolerance']) for s in strokes]
    strokes = [s for s in strokes if len(s) >= 2]

    # Longest first, so if the drawing is interrupted what is on the canvas is
    # the structure of the picture rather than a corner of its texture.
    strokes.sort(key=_length, reverse=True)
    strokes = strokes[: settings['max_strokes']]
    strokes = _order(strokes)

    return _result(strokes, image.size, original, detail, source)


# ---------------------------------------------------------------------------
# stages
# ---------------------------------------------------------------------------

def _sobel(pixels, np):
    """Gradient magnitude. Written out rather than imported: it is six lines."""
    padded = np.pad(pixels, 1, mode='edge')
    gx = (
        -1 * padded[:-2, :-2] + 1 * padded[:-2, 2:]
        - 2 * padded[1:-1, :-2] + 2 * padded[1:-1, 2:]
        - 1 * padded[2:, :-2] + 1 * padded[2:, 2:]
    )
    gy = (
        -1 * padded[:-2, :-2] - 2 * padded[:-2, 1:-1] - 1 * padded[:-2, 2:]
        + 1 * padded[2:, :-2] + 2 * padded[2:, 1:-1] + 1 * padded[2:, 2:]
    )
    return np.hypot(gx, gy)


def _thin(edges, magnitude, np):
    """
    Keep only local maxima along each axis.

    A real edge in a blurred image is three or four pixels wide, and walking it
    without this produces three or four parallel strokes — which is what makes
    a naive trace look like a scribble rather than a drawing.
    """
    padded = np.pad(magnitude, 1, mode='constant')
    horizontal = (magnitude >= padded[1:-1, :-2]) & (magnitude >= padded[1:-1, 2:])
    vertical = (magnitude >= padded[:-2, 1:-1]) & (magnitude >= padded[2:, 1:-1])
    return edges & (horizontal | vertical)


# The eight neighbours, ordered so a walk continues straight before it turns.
# Ordering matters: preferring the straight continuation keeps a long contour
# as one stroke instead of breaking it into pieces at every junction.
_NEIGHBOURS = ((1, 0), (0, 1), (-1, 0), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1))


def _walk(edges, np, min_run: int) -> list[list[tuple[float, float]]]:
    """
    Follow each ridge of edge pixels into an ordered polyline.

    Each pixel is used once. Every start is walked in both directions and the
    halves joined, because a contour picked up in the middle would otherwise
    become two strokes meeting at a random point.
    """
    height, width = edges.shape
    remaining = edges.copy()
    strokes: list[list[tuple[float, float]]] = []

    ys, xs = np.nonzero(edges)
    for start_y, start_x in zip(ys.tolist(), xs.tolist()):
        if not remaining[start_y, start_x]:
            continue

        remaining[start_y, start_x] = False
        forward = _follow(remaining, start_x, start_y, width, height)
        backward = _follow(remaining, start_x, start_y, width, height)

        points = list(reversed(backward)) + [(start_x, start_y)] + forward
        if len(points) >= min_run:
            strokes.append([(float(x), float(y)) for x, y in points])

    return strokes


def _follow(remaining, x: int, y: int, width: int, height: int) -> list:
    """Walk from one pixel until the ridge runs out, consuming as it goes."""
    path = []
    while True:
        found = None
        for dx, dy in _NEIGHBOURS:
            nx, ny = x + dx, y + dy
            if 0 <= nx < width and 0 <= ny < height and remaining[ny, nx]:
                found = (nx, ny)
                break
        if found is None:
            return path
        x, y = found
        remaining[y, x] = False
        path.append((x, y))


def _simplify(points: list, tolerance: float) -> list:
    """
    Douglas-Peucker.

    A traced contour is one point per pixel, and a straight run of forty of
    them is forty mouse moves that draw the same line two points would. The
    reduction is usually better than ten to one, which is the difference
    between a drawing that takes a minute and one that takes fifteen.
    """
    if len(points) < 3:
        return points

    start, end = points[0], points[-1]
    worst_index, worst = 0, 0.0
    for i in range(1, len(points) - 1):
        distance = _perpendicular(points[i], start, end)
        if distance > worst:
            worst_index, worst = i, distance

    if worst <= tolerance:
        return [start, end]

    left = _simplify(points[: worst_index + 1], tolerance)
    right = _simplify(points[worst_index:], tolerance)
    return left[:-1] + right


def _perpendicular(point, start, end) -> float:
    (px, py), (sx, sy), (ex, ey) = point, start, end
    dx, dy = ex - sx, ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)
    return abs(dy * px - dx * py + ex * sy - ey * sx) / math.hypot(dx, dy)


def _length(points) -> float:
    return sum(
        math.hypot(b[0] - a[0], b[1] - a[1])
        for a, b in zip(points, points[1:])
    )


def _order(strokes: list) -> list:
    """
    Nearest-neighbour, so the pen does not fly across the page between strokes.

    Purely cosmetic for the finished picture and very much not cosmetic while
    it is being drawn: an unordered trace looks like random flailing, and this
    is something the owner watches happen.
    """
    if not strokes:
        return strokes

    remaining = list(strokes)
    ordered = [remaining.pop(0)]

    while remaining:
        cx, cy = ordered[-1][-1]
        best, best_distance, reverse = 0, float('inf'), False
        for i, stroke in enumerate(remaining):
            head = math.hypot(stroke[0][0] - cx, stroke[0][1] - cy)
            tail = math.hypot(stroke[-1][0] - cx, stroke[-1][1] - cy)
            if head < best_distance:
                best, best_distance, reverse = i, head, False
            if tail < best_distance:
                best, best_distance, reverse = i, tail, True
        chosen = remaining.pop(best)
        ordered.append(list(reversed(chosen)) if reverse else chosen)

    return ordered


def _result(strokes, size, original, detail: str, source: str) -> dict:
    """
    Normalised to 0..1 against the traced size.

    So one trace fits any canvas: Paint at 800x600 and Paint maximised on a
    1440p screen take the same stroke list, and neither needs to know what the
    source image was.
    """
    width, height = size
    normalised = [
        {
            # A pencil line. Colour is a separate question the canvas driver
            # asks the application, not something a greyscale trace can know.
            'color': '#000000',
            'points': [
                [round(x / max(width - 1, 1), 5), round(y / max(height - 1, 1), 5)]
                for x, y in stroke
            ],
        }
        for stroke in strokes
    ]

    return {
        'source': source,
        'detail': detail,
        'source_size': list(original),
        'traced_size': [width, height],
        'strokes': normalised,
        'stroke_count': len(normalised),
        'point_count': sum(len(s['points']) for s in normalised),
        # Said here so it travels with the data, and whoever reports to the
        # owner has no excuse for overselling it.
        'note': 'An outline sketch traced from the image, not a reproduction of it.',
    }
