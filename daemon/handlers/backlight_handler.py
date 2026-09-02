"""
The keyboard backlight — is there one, how bright, what colour.

The owner's requirement was "first it should check if keyboard has the backlit
or not", and that is not a politeness: keyboard lighting is the least
standardised thing on a PC. There is no Windows API for it. Every vendor does
it differently, most laptops have nothing at all, and a handler that assumed
otherwise would fail in a way nobody could interpret.

So this is a chain of providers, each of which knows how to recognise its own
hardware and says what it can actually do:

    aura-hid    ASUS ROG keyboards on the Aura vendor HID interface.
                Brightness and per-device colour.
    asus-atk    Older ASUS models through the ATK WMI interface.
                Brightness only.
    (none)      Nothing recognised. Reported as `present: false` with the
                reason, which is a real answer.

Both ASUS providers are here because the first machine this ran on needed the
second one *not* to be trusted. `AsusAtkWmi_WMNB` is present on a ROG Strix
G513QY and `DEVS(0x00050021, n)` returns success for any n — and changes
nothing, because on that generation the lighting moved to the Aura HID and the
ATK device is vestigial. A provider that reports success while doing nothing is
worse than a missing one, so ATK is now tried *after* Aura and its writes are
read back through DSTS before being called a success.

**On honesty about the write.** `HidD_SetFeature` returning true means the
keyboard accepted the report. It does not mean the lights changed, and there is
no way to read the colour back to find out — the interface is write-only. So
this reports `applied: 'sent'` rather than claiming verification, and names the
one thing that commonly swallows it: Armoury Crate, which owns the device and
re-asserts its own profile. Saying "sent, and here is what could stop it
landing" is the truth; saying "done" would not be.
"""
from __future__ import annotations

import logging

from ._proc import try_run

log = logging.getLogger('BacklightHandler')

# ---------------------------------------------------------------------------
# ASUS Aura, over the vendor HID interface
# ---------------------------------------------------------------------------

AURA_VENDOR_ID = 0x0B05

# The lighting interface, identified by usage rather than by product.
#
# An Aura keyboard presents seven HID collections — a keyboard, a consumer
# control, several vendor-defined — and only this one takes lighting reports.
# Matching on usage page rather than on a list of product ids is what makes
# this work on the next ROG model as well as this one.
AURA_USAGE_PAGE = 0xFF31
AURA_USAGE = 0x0076

AURA_MAX_BRIGHTNESS = 3

# Product ids are used only to decide whether to look, not to decide what to
# send. Every known ROG laptop keyboard speaks the same lighting protocol.
AURA_PRODUCT_IDS = (
    0x1866, 0x1869, 0x1854, 0x19B6, 0x1A30, 0x1854, 0x18C6, 0x1837, 0x1822,
)


class AuraHid:
    name = 'aura-hid'
    supports_color = True
    levels = AURA_MAX_BRIGHTNESS + 1

    def __init__(self, device) -> None:
        self._device = device

    @classmethod
    def detect(cls):
        try:
            from .hid_raw import find_devices
        except Exception as exc:  # noqa: BLE001 - ctypes/Win32 unavailable
            log.debug('HID unavailable: %s', exc)
            return None

        for product in AURA_PRODUCT_IDS:
            for device in find_devices(AURA_VENDOR_ID, product):
                if device.usage_page == AURA_USAGE_PAGE and device.usage == AURA_USAGE:
                    return cls(device)
        return None

    def describe(self) -> dict:
        return {
            'provider': self.name,
            'device': self._device.path,
            'levels': self.levels,
            'supports_color': True,
        }

    def set_brightness(self, level: int) -> None:
        with self._device as handle:
            handle.set_feature(bytes([0x5A, 0xBA, 0xC5, 0xC4, level]))

    def set_color(self, red: int, green: int, blue: int) -> None:
        # Three reports, in this order, and all three are needed: the first
        # describes the mode, the second commits it to the keyboard's own
        # memory so it survives sleep, the third makes it visible now. Sending
        # only the first is the mistake that looks like "the colour did not
        # take" — it took, and was never applied.
        with self._device as handle:
            handle.set_feature(
                bytes([0x5D, 0xB3, 0x00, 0x00, red, green, blue,
                       0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
            )
            handle.set_feature(bytes([0x5D, 0xB5, 0x00, 0x00, 0x00]))
            handle.set_feature(bytes([0x5D, 0xB4]))


# ---------------------------------------------------------------------------
# ASUS ATK, over WMI
# ---------------------------------------------------------------------------

ATK_KEYBOARD_DEVICE = 0x00050021

# What ATK returns for a device it does not implement. Any other value means
# the device is real; this exact one means "there is no such thing here".
ATK_UNSUPPORTED = 0xFFFFFFFE

_ATK_READ = (
    '$i = Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB '
    '-ErrorAction Stop | Select-Object -First 1; '
    '(Invoke-CimMethod -InputObject $i -MethodName DSTS '
    '-Arguments @{{ Device_ID = [uint32]{device} }}).device_status'
)

_ATK_WRITE = (
    '$i = Get-CimInstance -Namespace root/wmi -ClassName AsusAtkWmi_WMNB '
    '-ErrorAction Stop | Select-Object -First 1; '
    'Invoke-CimMethod -InputObject $i -MethodName DEVS '
    '-Arguments @{{ Device_ID = [uint32]{device}; Control_status = [uint32]{value} }} '
    '| Out-Null'
)


class AsusAtk:
    name = 'asus-atk'
    supports_color = False
    levels = 4

    @classmethod
    def detect(cls):
        status = cls._read()
        if status is None or status == ATK_UNSUPPORTED:
            return None
        return cls()

    @staticmethod
    def _read():
        result = try_run(
            ['powershell', '-NoProfile', '-Command',
             _ATK_READ.format(device=ATK_KEYBOARD_DEVICE)],
            timeout=15,
        )
        if result is None or result.returncode != 0:
            return None
        try:
            return int((result.stdout or '').strip())
        except (TypeError, ValueError):
            return None

    def describe(self) -> dict:
        status = self._read()
        return {
            'provider': self.name,
            'levels': self.levels,
            'supports_color': False,
            'brightness': None if status is None else status & 0xFF,
        }

    def set_brightness(self, level: int) -> None:
        try_run(
            ['powershell', '-NoProfile', '-Command',
             _ATK_WRITE.format(device=ATK_KEYBOARD_DEVICE, value=level)],
            timeout=15,
        )
        # Read back. This provider is the reason read-back exists here: on a
        # G513QY it accepts every write and changes nothing.
        after = self._read()
        if after is not None and (after & 0xFF) != level:
            raise RuntimeError(
                f'The ATK interface accepted brightness {level} but still reports '
                f'{after & 0xFF}. On this model the keyboard lighting is not on '
                'the ATK interface — it is on the Aura HID device, which Dex '
                'uses when it is present.'
            )

    def set_color(self, *_rgb) -> None:
        raise ValueError(
            'This keyboard exposes brightness but not colour. The ATK interface '
            'has no colour control; only Aura-based keyboards do.'
        )


PROVIDERS = (AuraHid, AsusAtk)


def _detect():
    """
    The first provider that recognises this machine.

    Order matters and is not alphabetical: Aura is tried first because on
    models that have both, ATK is the one that lies.
    """
    for provider in PROVIDERS:
        try:
            found = provider.detect()
        except Exception as exc:  # noqa: BLE001 - one bad probe must not hide the rest
            log.debug('%s probe failed: %s', provider.name, exc)
            continue
        if found is not None:
            return found
    return None


class BacklightHandler:
    @staticmethod
    def get_keyboard_backlight(_params: dict) -> dict:
        """
        Is there a controllable backlight, and what can it do?

        Always answers. A machine with no backlight gets `present: false` and
        the reason, which is what "check first" has to mean if it is to be
        useful — a task that asks and gets an exception has learned nothing.
        """
        provider = _detect()
        if provider is None:
            return {
                'present': False,
                'reason':
                    'No controllable keyboard backlight found. Dex looked for an '
                    'ASUS Aura lighting device on the HID bus and for the ASUS ATK '
                    'WMI interface. Most keyboards have neither: lighting is often '
                    'wired straight to the firmware with no software control at all, '
                    'in which case the Fn key is the only way to change it.',
                'providers_tried': [p.name for p in PROVIDERS],
            }

        described = provider.describe()
        holding = _holders()
        return {
            'present': True,
            'supports_brightness': True,
            **described,
            # Reported by the read too, so a plan can mention it before trying
            # rather than only after the change fails to stick.
            'held_by': holding,
        }

    @staticmethod
    def set_keyboard_backlight(params: dict) -> dict:
        """
        params:
          brightness  0 .. levels-1
          color       "#RRGGBB", or a name Dex resolves before it gets here

        Either, or both. Neither is an error rather than a no-op — a step that
        was asked to change something and changed nothing should say so.
        """
        provider = _detect()
        if provider is None:
            raise RuntimeError(
                BacklightHandler.get_keyboard_backlight({})['reason'],
            )

        brightness = params.get('brightness')
        color = params.get('color')
        if brightness is None and color is None:
            raise ValueError(
                'set_keyboard_backlight needs a brightness, a color, or both.',
            )

        changed: dict = {'provider': provider.name}

        if brightness is not None:
            level = int(brightness)
            top = provider.levels - 1
            if not 0 <= level <= top:
                raise ValueError(
                    f'Brightness must be 0 to {top} on this keyboard; got {level}.',
                )
            provider.set_brightness(level)
            changed['brightness'] = level

        if color is not None:
            if not provider.supports_color:
                raise ValueError(
                    f'This keyboard ({provider.name}) can change brightness but not '
                    'colour.',
                )
            red, green, blue = parse_color(color)
            provider.set_color(red, green, blue)
            changed['color'] = f'#{red:02X}{green:02X}{blue:02X}'

        # Said plainly rather than dressed up as verification. The lighting
        # interface is write-only: there is no way to read the colour back, so
        # "the keyboard accepted it" is the strongest true statement available.
        changed['applied'] = 'sent'

        # Say who else is driving the lights.
        #
        # The write really was accepted; the keyboard confirms that. Whether it
        # is still purple a second later depends on whether something is
        # re-asserting its own profile, and that is a question this can answer
        # cheaply and the owner cannot answer at all from a success message.
        holding = _holders()
        if holding:
            names = ', '.join(holding)
            changed['held_by'] = holding
            changed['note'] = (
                f'The keyboard accepted it, but {names} '
                f'{"is" if len(holding) == 1 else "are"} running and will '
                're-apply its own lighting within a few seconds. Close it, or '
                'set the colour there instead — two programs cannot both own '
                'the lights.'
            )
        return changed


def parse_color(value) -> tuple[int, int, int]:
    """
    `#RRGGBB`, `RRGGBB`, `#RGB`, or a small set of names.

    The names are here because a plan says "make it red", not "make it
    #FF0000", and asking the model to convert is asking it to be a lookup
    table. Anything not recognised is refused by name rather than guessed at —
    a wrong colour is a confusing success.
    """
    if isinstance(value, (list, tuple)) and len(value) == 3:
        return tuple(_channel(v) for v in value)  # type: ignore[return-value]

    text = str(value).strip().lower()
    if text in NAMED_COLORS:
        return NAMED_COLORS[text]

    hex_digits = text.lstrip('#')
    if len(hex_digits) == 3:
        hex_digits = ''.join(c * 2 for c in hex_digits)
    if len(hex_digits) != 6:
        raise ValueError(
            f'"{value}" is not a colour Dex recognises. Use #RRGGBB, or one of: '
            + ', '.join(sorted(NAMED_COLORS)),
        )
    try:
        return (
            int(hex_digits[0:2], 16),
            int(hex_digits[2:4], 16),
            int(hex_digits[4:6], 16),
        )
    except ValueError:
        raise ValueError(f'"{value}" is not a valid hex colour.') from None


def _channel(value) -> int:
    number = int(value)
    if not 0 <= number <= 255:
        raise ValueError(f'Colour channel {number} is outside 0-255.')
    return number


NAMED_COLORS = {
    'red': (255, 0, 0),
    'green': (0, 255, 0),
    'blue': (0, 0, 255),
    'white': (255, 255, 255),
    'black': (0, 0, 0),
    'off': (0, 0, 0),
    'yellow': (255, 255, 0),
    'cyan': (0, 255, 255),
    'aqua': (0, 255, 255),
    'magenta': (255, 0, 255),
    'pink': (255, 105, 180),
    'purple': (128, 0, 255),
    'violet': (128, 0, 255),
    'orange': (255, 100, 0),
    'teal': (0, 128, 128),
    'lime': (128, 255, 0),
    'gold': (255, 200, 0),
    'warm': (255, 160, 60),
}


# Software that owns the lighting and re-asserts its own profile.
#
# This list is the difference between a useful answer and a baffling one. Asked
# to set the keyboard to purple, Dex sent the report, the keyboard accepted it,
# and nothing changed — because G-Helper was running and re-applied its own
# colours immediately after. Dex reported plain success, because the check only
# looked for `ArmouryCrate.exe` and there was no such process: what was actually
# running was `GHelper`, `ArmouryCrateControlInterface` and
# `ArmouryCrateKeyControl`.
#
# Names are matched as prefixes, without .exe, because every one of these ships
# under several executable names across versions.
LIGHTING_HOLDERS = (
    ('ghelper', 'G-Helper'),
    ('armourycrate', 'Armoury Crate'),
    ('asusservice', 'Armoury Crate'),
    ('lightingservice', 'Aura / Armoury Crate lighting service'),
    ('aurasync', 'Aura Sync'),
    ('rog', 'ROG software'),
    ('icue', 'iCUE'),
    ('corsair', 'iCUE'),
    ('synapse', 'Razer Synapse'),
    ('razer', 'Razer Synapse'),
    ('ghub', 'Logitech G HUB'),
    ('lghub', 'Logitech G HUB'),
    ('signalrgb', 'SignalRGB'),
    ('msimystic', 'MSI Mystic Light'),
    ('openrgb', 'OpenRGB'),
)


def _holders() -> list:
    """
    Which lighting programs are running right now.

    One `tasklist` call, parsed here rather than filtered by the OS, because a
    per-name filter would be a dozen subprocesses to answer one question.
    """
    result = try_run(['tasklist', '/FO', 'CSV', '/NH'], timeout=15)
    if not result or result.returncode != 0:
        return []

    running = (result.stdout or '').lower()
    found = []
    for needle, label in LIGHTING_HOLDERS:
        if needle in running and label not in found:
            found.append(label)
    return found
