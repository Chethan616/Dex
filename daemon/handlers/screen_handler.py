"""
Capture the screen to a PNG file.

The one screenshot Dex had was `can_browse_web`'s, which photographs a *web
page* inside the browser agent's Chromium. There was no way to photograph the
desktop, so "screenshot that error and send it to me on WhatsApp" — the thing
a phone-side owner actually asks for — had nothing to call, and the composer's
"Take screenshot" menu item pointed at nothing at all.

Deliberately here in the daemon rather than in the desktop agent:

  * The desktop agent's `screenshot_b64` exists only inside its GUI loop, as a
    frame for a vision model. It is not an action anything can plan.
  * The daemon runs elevated *in the owner's session* — that is the whole
    reason Full Access registers a logon task instead of a service. A capture
    from session 0 would be a picture of a desktop nobody is looking at.

Returns the path rather than the bytes. A 2560x1440 PNG is megabytes, the pipe
carries one JSON line, and every consumer — the delivery agent, an attachment
chip, a later `send_file` — wants a file anyway.

This is a read. It changes nothing, so it is Tier 4 and runs silently. What
happens to the file afterwards is a separate step with its own tier: sending it
to anyone is Tier 2, and always was.
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path

log = logging.getLogger('ScreenHandler')

# Where captures go when the caller does not say.
#
# Under Pictures, not the Dex workspace: a screenshot is something the owner
# will want to find later in the place they look for pictures, and File
# Explorer's Pictures library is that place.
DEFAULT_DIR = Path.home() / 'Pictures' / 'Dex'


class ScreenHandler:
    @staticmethod
    def capture(params: dict) -> dict:
        """
        params:
          path    optional. Where to write the PNG. A directory is accepted and
                  a timestamped name is generated inside it.
          region  optional [x, y, width, height]. Omitted means every monitor,
                  which is what "the screen" means on a two-monitor desk.
        """
        try:
            from PIL import ImageGrab
        except ImportError as exc:  # pragma: no cover - depends on the install
            raise RuntimeError(
                'Screen capture needs Pillow. Install it with: pip install Pillow'
            ) from exc

        target = _resolve_path(params.get('path'))
        target.parent.mkdir(parents=True, exist_ok=True)

        region = params.get('region')
        if region:
            if len(region) != 4:
                raise ValueError('region must be [x, y, width, height]')
            x, y, w, h = (int(v) for v in region)
            box = (x, y, x + w, y + h)
            image = ImageGrab.grab(bbox=box, all_screens=True)
        else:
            # all_screens spans the virtual desktop. Without it a second monitor
            # is silently cropped away, and the owner is told the screenshot
            # succeeded.
            image = ImageGrab.grab(all_screens=True)

        image.save(target, 'PNG')
        size = os.path.getsize(target)
        log.info('Captured %sx%s to %s (%s bytes)', image.width, image.height, target, size)

        return {
            'path': str(target),
            'width': image.width,
            'height': image.height,
            'bytes': size,
        }


def _resolve_path(raw) -> Path:
    if not raw:
        return DEFAULT_DIR / _stamped_name()

    path = Path(str(raw)).expanduser()
    # A directory, or something that looks like one, gets a generated name —
    # a planner writes `path: "C:/Users/me/Pictures"` about half the time and
    # the alternative is PermissionError on a folder.
    if path.is_dir() or not path.suffix:
        return path / _stamped_name()
    if path.suffix.lower() != '.png':
        path = path.with_suffix('.png')
    return path


def _stamped_name() -> str:
    return time.strftime('dex-%Y%m%d-%H%M%S.png')
