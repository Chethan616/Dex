"""
The keyboard backlight provider chain.

    npm run test:backlight

Keyboard lighting is the least standardised thing on a PC: no Windows API, a
different mechanism per vendor, and most laptops have nothing controllable at
all. So the design is a chain of providers that each recognise their own
hardware, and what is worth testing is the chain rather than any one vendor.

The case that shaped it, and the one these tests exist to keep fixed: on a ROG
Strix G513QY the ASUS ATK WMI interface **is present**, and
`DEVS(0x00050021, n)` returns success for every n while changing nothing —
because on that generation the lighting moved to the Aura HID and ATK is
vestigial. A provider that reports success while doing nothing is worse than no
provider at all, so Aura is probed first and ATK's writes are read back.

The colour parser gets the same attention because a wrong colour is a confusing
success: the keyboard changes, just not to what was asked for.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'daemon'))

from handlers import backlight_handler as bl  # noqa: E402

failures = 0


def check(label: str, ok: bool, detail: str = '') -> None:
    global failures
    if ok:
        print(f'ok   {label}')
    else:
        failures += 1
        print(f'FAIL {label}{": " + detail if detail else ""}')


class FakeProvider:
    """Stands in for real hardware. Records what it was asked to do."""

    name = 'fake'
    levels = 4

    def __init__(self, supports_color: bool = True) -> None:
        self.supports_color = supports_color
        self.brightness = None
        self.color = None

    @classmethod
    def detect(cls):
        return cls()

    def describe(self) -> dict:
        return {'provider': self.name, 'levels': self.levels,
                'supports_color': self.supports_color}

    def set_brightness(self, level: int) -> None:
        self.brightness = level

    def set_color(self, r: int, g: int, b: int) -> None:
        if not self.supports_color:
            raise ValueError('no colour here')
        self.color = (r, g, b)


class Absent:
    """A provider that recognises nothing — every machine without the hardware."""
    name = 'absent'

    @classmethod
    def detect(cls):
        return None


class Exploding:
    """A probe that raises. One bad provider must not hide the rest."""
    name = 'exploding'

    @classmethod
    def detect(cls):
        raise OSError('the bus is on fire')


def with_providers(*providers):
    """Swap the chain for the duration of one check."""
    original = bl.PROVIDERS
    bl.PROVIDERS = providers
    return original


print('— detection —')

original = with_providers(Absent)
try:
    result = bl.BacklightHandler.get_keyboard_backlight({})
    check('no hardware reports present: false', result['present'] is False)
    check('and says why, at length enough to be useful',
          len(result.get('reason', '')) > 40, result.get('reason', ''))
    check('and names what it looked for',
          'providers_tried' in result and 'absent' in result['providers_tried'])
finally:
    bl.PROVIDERS = original

original = with_providers(Exploding, FakeProvider)
try:
    result = bl.BacklightHandler.get_keyboard_backlight({})
    check('a provider that raises does not hide the ones after it',
          result['present'] is True and result['provider'] == 'fake')
finally:
    bl.PROVIDERS = original

print('\n— order matters: the first that recognises the machine wins —')

first = FakeProvider()
first.name = 'first'


class First:
    name = 'first'

    @classmethod
    def detect(cls):
        return first


original = with_providers(First, FakeProvider)
try:
    result = bl.BacklightHandler.get_keyboard_backlight({})
    check('the earlier provider is chosen', result['provider'] == 'first',
          result['provider'])
finally:
    bl.PROVIDERS = original

print('\n— setting —')

original = with_providers(FakeProvider)
try:
    result = bl.BacklightHandler.set_keyboard_backlight({'brightness': 2})
    check('brightness is passed through', result['brightness'] == 2)

    result = bl.BacklightHandler.set_keyboard_backlight({'color': 'red'})
    check('a colour name resolves', result['color'] == '#FF0000', str(result))

    result = bl.BacklightHandler.set_keyboard_backlight(
        {'brightness': 1, 'color': '#00FF00'})
    check('both at once', result['brightness'] == 1 and result['color'] == '#00FF00')

    # The interface is write-only. Claiming verification would be a lie.
    check('it says "sent" rather than claiming it was seen',
          result['applied'] == 'sent', result['applied'])

    try:
        bl.BacklightHandler.set_keyboard_backlight({})
        check('a request that changes nothing is refused', False, 'accepted')
    except ValueError:
        check('a request that changes nothing is refused', True)

    for level in (-1, 4, 99):
        try:
            bl.BacklightHandler.set_keyboard_backlight({'brightness': level})
            check(f'brightness {level} is refused', False, 'accepted')
        except ValueError as exc:
            check(f'brightness {level} is refused, naming the range',
                  '0 to 3' in str(exc), str(exc))
finally:
    bl.PROVIDERS = original

print('\n— a brightness-only keyboard refuses colour by name —')


class BrightnessOnly:
    name = 'brightness-only'

    @classmethod
    def detect(cls):
        return FakeProvider(supports_color=False)


original = with_providers(BrightnessOnly)
try:
    try:
        bl.BacklightHandler.set_keyboard_backlight({'color': 'blue'})
        check('colour on a brightness-only keyboard is refused', False, 'accepted')
    except ValueError as exc:
        check('colour on a brightness-only keyboard is refused, and says so',
              'not' in str(exc).lower() and 'colour' in str(exc).lower(), str(exc))

    result = bl.BacklightHandler.set_keyboard_backlight({'brightness': 3})
    check('but brightness still works', result['brightness'] == 3)
finally:
    bl.PROVIDERS = original

print('\n— setting anything with no hardware is refused, not silently ignored —')

original = with_providers(Absent)
try:
    try:
        bl.BacklightHandler.set_keyboard_backlight({'brightness': 1})
        check('refused when there is no backlight', False, 'accepted')
    except RuntimeError as exc:
        check('refused when there is no backlight, with the detection reason',
              len(str(exc)) > 40)
finally:
    bl.PROVIDERS = original

print('\n— colours —')

cases = [
    ('#FF0000', (255, 0, 0)),
    ('ff0000', (255, 0, 0)),
    ('#0f0', (0, 255, 0)),
    ('red', (255, 0, 0)),
    ('WHITE', (255, 255, 255)),
    ('off', (0, 0, 0)),
    ([10, 20, 30], (10, 20, 30)),
]
for value, expected in cases:
    check(f'{value!r} -> {expected}', bl.parse_color(value) == expected,
          str(bl.parse_color(value)))

for bad in ('chartreuse', '#GGGGGG', '12345', ''):
    try:
        bl.parse_color(bad)
        check(f'{bad!r} is refused', False, 'accepted')
    except ValueError:
        check(f'{bad!r} is refused rather than guessed at', True)

print()
if failures:
    print(f'{failures} check(s) failed.')
    sys.exit(1)
print('PASSED  the backlight is detected before it is touched.')
