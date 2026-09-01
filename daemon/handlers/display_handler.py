"""
Screen resolution, refresh rate and brightness — Tier 1.

This exists because of what it replaces. Asked to set the display to 1080p,
Dex planned eight steps: open Settings, wait for it, click Display, click
Display resolution, click "1920 x 1080 (Recommended)", and so on. It got six of
them right and failed on the seventh, because Windows writes `1920 × 1080` with
a multiplication sign and the planner had written the letter x.

That failure was worth fixing — and it was also the wrong argument to be having.
Windows has had an API for this since Windows 95. `ChangeDisplaySettingsEx` sets
the mode in one call, atomically, with a return code that says whether it
worked. No window opens, nothing is clicked, nothing depends on which build of
Settings is installed or what the dropdown happens to be called this year.

The rule the owner stated, and the right one: **if it can be done through an
API, it is not a job for the UI tier.** The GUI tiers exist for software that
offers no other way in. The Settings app is not that; it is a front end for
APIs Dex can call directly.

Brightness goes through WMI rather than ctypes because the monitor class is
only exposed there, and it is a genuine one-liner. It runs through `_proc`, so
it inherits the no-console guarantee like every other shell-out.
"""
from __future__ import annotations

import ctypes
import logging
from ctypes import wintypes

from ._proc import run, try_run

log = logging.getLogger('DisplayHandler')

CCHDEVICENAME = 32
CCHFORMNAME = 32

ENUM_CURRENT_SETTINGS = -1
ENUM_REGISTRY_SETTINGS = -2

DM_BITSPERPEL = 0x00040000
DM_PELSWIDTH = 0x00080000
DM_PELSHEIGHT = 0x00100000
DM_DISPLAYFREQUENCY = 0x00400000

CDS_UPDATEREGISTRY = 0x00000001
CDS_TEST = 0x00000002

# ChangeDisplaySettingsEx return codes, with what each actually means to
# someone reading the message rather than the docs.
DISP_CHANGE = {
    0: (True, 'the change took effect'),
    1: (False, 'the change needs a restart to take effect'),
    -1: (False, 'the graphics driver rejected the mode'),
    -2: (False, 'the display does not support that mode'),
    -3: (False, 'the settings could not be written to the registry'),
    -4: (False, 'another display change is already in progress'),
    -5: (False, 'an invalid set of flags was passed'),
    -6: (False, 'an invalid parameter was passed'),
}


class POINTL(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]


class _DevModeDisplay(ctypes.Structure):
    """The display arm of DEVMODEW's first union."""

    _fields_ = [
        ('dmPosition', POINTL),
        ('dmDisplayOrientation', wintypes.DWORD),
        ('dmDisplayFixedOutput', wintypes.DWORD),
    ]


class DEVMODEW(ctypes.Structure):
    """
    DEVMODEW, with both unions collapsed to their display members.

    The printer members of each union are the same width, so the struct size
    and every field offset after them are unaffected. Writing it this way keeps
    the layout honest rather than padding with anonymous bytes whose meaning
    nobody could check later.
    """

    _fields_ = [
        ('dmDeviceName', wintypes.WCHAR * CCHDEVICENAME),
        ('dmSpecVersion', wintypes.WORD),
        ('dmDriverVersion', wintypes.WORD),
        ('dmSize', wintypes.WORD),
        ('dmDriverExtra', wintypes.WORD),
        ('dmFields', wintypes.DWORD),
        ('dmDisplay', _DevModeDisplay),
        ('dmColor', ctypes.c_short),
        ('dmDuplex', ctypes.c_short),
        ('dmYResolution', ctypes.c_short),
        ('dmTTOption', ctypes.c_short),
        ('dmCollate', ctypes.c_short),
        ('dmFormName', wintypes.WCHAR * CCHFORMNAME),
        ('dmLogPixels', wintypes.WORD),
        ('dmBitsPerPel', wintypes.DWORD),
        ('dmPelsWidth', wintypes.DWORD),
        ('dmPelsHeight', wintypes.DWORD),
        ('dmDisplayFlags', wintypes.DWORD),
        ('dmDisplayFrequency', wintypes.DWORD),
        ('dmICMMethod', wintypes.DWORD),
        ('dmICMIntent', wintypes.DWORD),
        ('dmMediaType', wintypes.DWORD),
        ('dmDitherType', wintypes.DWORD),
        ('dmReserved1', wintypes.DWORD),
        ('dmReserved2', wintypes.DWORD),
        ('dmPanningWidth', wintypes.DWORD),
        ('dmPanningHeight', wintypes.DWORD),
    ]


user32 = ctypes.windll.user32


def _current_mode(device: str | None = None) -> DEVMODEW:
    mode = DEVMODEW()
    mode.dmSize = ctypes.sizeof(DEVMODEW)
    ok = user32.EnumDisplaySettingsW(
        ctypes.c_wchar_p(device) if device else None,
        ENUM_CURRENT_SETTINGS,
        ctypes.byref(mode),
    )
    if not ok:
        raise RuntimeError('Could not read the current display mode')
    return mode


def _available_modes(device: str | None = None) -> list:
    """Every mode the driver reports, de-duplicated, largest first."""
    seen = set()
    modes = []
    index = 0
    while True:
        mode = DEVMODEW()
        mode.dmSize = ctypes.sizeof(DEVMODEW)
        if not user32.EnumDisplaySettingsW(
            ctypes.c_wchar_p(device) if device else None,
            index,
            ctypes.byref(mode),
        ):
            break
        index += 1
        key = (mode.dmPelsWidth, mode.dmPelsHeight, mode.dmDisplayFrequency)
        if key in seen or mode.dmBitsPerPel < 24:
            continue
        seen.add(key)
        modes.append({
            'width': mode.dmPelsWidth,
            'height': mode.dmPelsHeight,
            'refresh_hz': mode.dmDisplayFrequency,
        })
    modes.sort(key=lambda m: (m['width'], m['height'], m['refresh_hz']), reverse=True)
    return modes


class DisplayHandler:

    @staticmethod
    def get_display(params: dict) -> dict:
        """The current mode, and everything the display will accept."""
        device = params.get('device')
        mode = _current_mode(device)

        return {
            'width': mode.dmPelsWidth,
            'height': mode.dmPelsHeight,
            'refresh_hz': mode.dmDisplayFrequency,
            'bits_per_pixel': mode.dmBitsPerPel,
            'resolution': f'{mode.dmPelsWidth}x{mode.dmPelsHeight}',
            'available': _available_modes(device),
        }

    @staticmethod
    def set_display(params: dict) -> dict:
        """
        Set resolution and/or refresh rate.

        Tested before it is applied. `CDS_TEST` asks the driver whether the mode
        is possible without changing anything, so an unsupported combination is
        refused with the display untouched rather than left mid-change or
        black. A resolution the panel cannot do is a mistake the owner should
        hear about, not watch happen.
        """
        device = params.get('device')
        current = _current_mode(device)

        width = params.get('width')
        height = params.get('height')
        refresh = params.get('refresh_hz') or params.get('refresh')

        # "1920x1080" or "1920 × 1080" as one string, because that is how a
        # person says it and how a planner will pass it along.
        raw = params.get('resolution')
        if raw and not (width and height):
            cleaned = str(raw).lower().replace('×', 'x').replace(' ', '')
            if 'x' in cleaned:
                left, _, right = cleaned.partition('x')
                if left.isdigit() and right.isdigit():
                    width, height = int(left), int(right)

        if not any((width, height, refresh)):
            raise ValueError(
                'set_display needs a resolution (e.g. "1920x1080") '
                'and/or refresh_hz'
            )

        mode = DEVMODEW()
        ctypes.memmove(ctypes.byref(mode), ctypes.byref(current), ctypes.sizeof(DEVMODEW))
        mode.dmSize = ctypes.sizeof(DEVMODEW)
        mode.dmFields = 0

        if width and height:
            mode.dmPelsWidth = int(width)
            mode.dmPelsHeight = int(height)
            mode.dmFields |= DM_PELSWIDTH | DM_PELSHEIGHT
        if refresh:
            mode.dmDisplayFrequency = int(refresh)
            mode.dmFields |= DM_DISPLAYFREQUENCY

        target = (
            f'{mode.dmPelsWidth}x{mode.dmPelsHeight}'
            f'{f" @ {mode.dmDisplayFrequency}Hz" if refresh else ""}'
        )

        device_arg = ctypes.c_wchar_p(device) if device else None

        tested = user32.ChangeDisplaySettingsExW(
            device_arg, ctypes.byref(mode), None, CDS_TEST, None,
        )
        if tested != 0:
            _, why = DISP_CHANGE.get(tested, (False, f'error {tested}'))
            offered = _available_modes(device)[:8]
            raise ValueError(
                f'Cannot set the display to {target}: {why}. '
                f'This display offers: '
                + ', '.join(f"{m['width']}x{m['height']}@{m['refresh_hz']}Hz" for m in offered)
            )

        applied = user32.ChangeDisplaySettingsExW(
            device_arg, ctypes.byref(mode), None, CDS_UPDATEREGISTRY, None,
        )
        ok, why = DISP_CHANGE.get(applied, (False, f'error {applied}'))
        if not ok:
            raise RuntimeError(f'Could not set the display to {target}: {why}')

        after = _current_mode(device)
        log.info('Display set to %s', target)
        return {
            'requested': target,
            'width': after.dmPelsWidth,
            'height': after.dmPelsHeight,
            'refresh_hz': after.dmDisplayFrequency,
            'resolution': f'{after.dmPelsWidth}x{after.dmPelsHeight}',
            'was': f'{current.dmPelsWidth}x{current.dmPelsHeight}',
        }

    @staticmethod
    def get_brightness(_params: dict) -> dict:
        """
        Brightness, from WMI.

        Only built-in panels report this. An external monitor is driven over
        DDC/CI, which this does not do — and saying so is better than returning
        a plausible zero.
        """
        output = try_run([
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness'
            ' -ErrorAction Stop).CurrentBrightness',
        ])
        value = output.stdout.strip().splitlines()
        if not output.ok or not value or not value[0].strip().isdigit():
            return {
                'supported': False,
                'reason': 'This display does not report brightness through WMI — '
                          'that is normal for external monitors, which use DDC/CI.',
            }
        return {'supported': True, 'level': int(value[0].strip())}

    @staticmethod
    def set_brightness(params: dict) -> dict:
        """Set the built-in panel's brightness, 0-100."""
        raw = params.get('level')
        if raw is None:
            raise ValueError('set_brightness needs a level between 0 and 100')
        level = max(0, min(100, int(raw)))

        run([
            'powershell', '-NoProfile', '-NonInteractive', '-Command',
            '$m = Get-CimInstance -Namespace root/WMI '
            '-ClassName WmiMonitorBrightnessMethods -ErrorAction Stop; '
            f'Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness '
            f'-Arguments @{{Brightness = {level}; Timeout = 5}}',
        ])

        after = DisplayHandler.get_brightness({})
        log.info('Brightness set to %s', level)
        return {'requested': level, 'level': after.get('level'), 'supported': True}
