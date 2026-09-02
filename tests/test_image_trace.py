"""
Turning a picture into strokes.

    npm run test:trace

This is the half of "draw it in Paint" that has no mouse in it, which is
exactly why it is worth pinning here: the drawing half needs a real screen and
a real window, and this half is arithmetic that either works on every image or
does not.

What the tests are actually protecting:

  * **Coordinates stay in 0..1.** They are multiplied by a canvas rectangle on
    the other side. A stroke at 1.4 is a mouse drag off the canvas and across
    the desktop, and the canvas driver clamps it — but a tracer that emits one
    is already wrong.

  * **Simplification really simplifies.** A traced contour is one point per
    pixel. Without Douglas-Peucker a photograph is tens of thousands of mouse
    moves, which is the difference between a drawing that takes a minute and
    one that never finishes.

  * **A blank image traces to nothing, and says so** rather than raising. "There
    are no edges in this picture" is an answer.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'agents' / 'files'))
sys.setrecursionlimit(20000)

from PIL import Image, ImageDraw  # noqa: E402

from image_trace import trace_image  # noqa: E402

failures = 0


def check(label: str, ok: bool, detail: str = '') -> None:
    global failures
    if ok:
        print(f'ok   {label}')
    else:
        failures += 1
        print(f'FAIL {label}{": " + detail if detail else ""}')


def make(name: str, draw) -> str:
    import tempfile
    image = Image.new('RGB', (400, 300), 'white')
    draw(ImageDraw.Draw(image))
    path = Path(tempfile.gettempdir()) / f'dex-trace-{name}.png'
    image.save(path)
    return str(path)


print('— a shape traces to strokes —')

square = make('square', lambda d: d.rectangle([80, 60, 320, 240], outline='black', width=4))
result = trace_image({'path': square})

check('a square produces strokes', result['stroke_count'] > 0,
      f"{result['stroke_count']} strokes")
check('and not an absurd number of them', result['stroke_count'] < 40,
      f"{result['stroke_count']} strokes for four lines")
check('the note says what this actually is',
      'sketch' in result['note'].lower() and 'not a reproduction' in result['note'].lower(),
      result['note'])

print('\n— coordinates are normalised, because a canvas multiplies them —')

points = [p for stroke in result['strokes'] for p in stroke['points']]
check('every x is within 0..1', all(0.0 <= p[0] <= 1.0 for p in points),
      f'min {min(p[0] for p in points)}, max {max(p[0] for p in points)}')
check('every y is within 0..1', all(0.0 <= p[1] <= 1.0 for p in points),
      f'min {min(p[1] for p in points)}, max {max(p[1] for p in points)}')

# The square is inset, so a trace that filled the frame would mean the mapping
# is wrong rather than the edges being found.
check('the traced shape sits where the square does',
      0.1 < min(p[0] for p in points) < 0.3 and 0.7 < max(p[0] for p in points) < 0.9,
      f'x spans {min(p[0] for p in points):.2f}..{max(p[0] for p in points):.2f}')

print('\n— simplification —')

circle = make('circle', lambda d: d.ellipse([60, 40, 340, 260], outline='black', width=3))
traced = trace_image({'path': circle})
perimeter_pixels = 2 * 3.14159 * 140  # roughly, at the traced scale
check('a curve is far fewer points than pixels',
      traced['point_count'] < perimeter_pixels,
      f"{traced['point_count']} points for ~{int(perimeter_pixels)} pixels of edge")
check('but enough points to still be a curve', traced['point_count'] > 8,
      f"{traced['point_count']} points")

print('\n— detail settings differ, in the direction they claim —')

fine = trace_image({'path': circle, 'detail': 'fine'})
check('fine keeps more than sketch',
      fine['point_count'] >= traced['point_count'],
      f"fine {fine['point_count']} vs sketch {traced['point_count']}")

print('\n— nothing to trace is an answer, not an error —')

blank = make('blank', lambda d: None)
empty = trace_image({'path': blank})
check('a blank image returns no strokes rather than raising',
      empty['stroke_count'] == 0, f"{empty['stroke_count']} strokes")
check('and still reports its size', empty['source_size'] == [400, 300],
      str(empty['source_size']))

print('\n— refusals —')

try:
    trace_image({'path': square, 'detail': 'photorealistic'})
    check('an unknown detail level is refused', False, 'it was accepted')
except ValueError as exc:
    check('an unknown detail level is refused by name', 'detail must be' in str(exc))

try:
    trace_image({})
    check('a missing path is refused', False, 'it was accepted')
except ValueError:
    check('a missing path is refused', True)

print()
if failures:
    print(f'{failures} check(s) failed.')
    sys.exit(1)
print('PASSED  a picture becomes strokes a canvas can take.')
