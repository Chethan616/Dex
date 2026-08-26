"""
Audio — Tier 1.

Setting the volume is the canonical example of why the deterministic tier
exists. The vision path would open the Settings app, find a slider, and drag it
to a pixel it guessed corresponded to 30%. This asks the Core Audio API for the
scalar and sets it. It takes microseconds, cannot be off by a pixel, and reads
back exactly.
"""
from __future__ import annotations

import logging

log = logging.getLogger('AudioHandler')

_endpoint = None


def _volume():
    """The default render endpoint's IAudioEndpointVolume, cached."""
    global _endpoint
    if _endpoint is not None:
        return _endpoint

    try:
        from pycaw.pycaw import AudioUtilities
    except ImportError as exc:  # pragma: no cover - depends on host install
        raise RuntimeError(
            'Audio control needs pycaw — install with: pip install pycaw comtypes'
        ) from exc

    speakers = AudioUtilities.GetSpeakers()

    # Current pycaw hands back an AudioDevice wrapper exposing EndpointVolume
    # directly. Older releases returned the raw IMMDevice, which had to be
    # Activate()d into the interface. Support both — this package changes shape
    # between versions and a daemon should not break on a routine pip upgrade.
    endpoint = getattr(speakers, 'EndpointVolume', None)
    if endpoint is None:
        from ctypes import POINTER, cast
        from comtypes import CLSCTX_ALL
        from pycaw.pycaw import IAudioEndpointVolume

        interface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
        endpoint = cast(interface, POINTER(IAudioEndpointVolume))

    _endpoint = endpoint
    return _endpoint


class AudioHandler:

    @staticmethod
    def get_volume(params: dict) -> dict:
        volume = _volume()
        level = round(volume.GetMasterVolumeLevelScalar() * 100)
        return {'level': level, 'muted': bool(volume.GetMute())}

    @staticmethod
    def set_volume(params: dict) -> dict:
        raw = params.get('level')
        if raw is None:
            raise ValueError('set_volume needs level (0-100)')

        level = int(raw)
        if not 0 <= level <= 100:
            raise ValueError(f'level must be 0-100, got {level}')

        volume = _volume()
        volume.SetMasterVolumeLevelScalar(level / 100.0, None)

        # Read back rather than trusting the setter. Windows rounds to the
        # nearest representable step, so the honest answer is what the endpoint
        # now reports, not what was asked for.
        actual = round(volume.GetMasterVolumeLevelScalar() * 100)
        log.info('Volume set to %s%% (requested %s%%)', actual, level)
        return {'requested': level, 'level': actual, 'muted': bool(volume.GetMute())}

    @staticmethod
    def set_mute(params: dict) -> dict:
        muted = bool(params.get('muted', True))
        volume = _volume()
        volume.SetMute(1 if muted else 0, None)
        return {'muted': bool(volume.GetMute())}
