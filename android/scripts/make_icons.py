"""
Builds the Android launcher/notification icons from the DEX logo
(icons-no-wordmarked/png/1024x1024.png).

  mipmap-*/ic_launcher_foreground.png   logo inside the adaptive-icon safe zone
  mipmap-*/ic_launcher_monochrome.png   white silhouette (Android 13 themed icons)
  drawable-*/ic_notification.png        white silhouette, 24dp status-bar icon

Run from the repo root:  python android/scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "icons-no-wordmarked" / "png" / "1024x1024.png"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

DENSITIES = {"mdpi": 1.0, "hdpi": 1.5, "xhdpi": 2.0, "xxhdpi": 3.0, "xxxhdpi": 4.0}


def trimmed(img: Image.Image) -> Image.Image:
    return img.crop(img.getbbox())


def silhouette(img: Image.Image) -> Image.Image:
    white = Image.new("RGBA", img.size, (255, 255, 255, 0))
    white.putalpha(img.getchannel("A"))
    return white


def centered(logo: Image.Image, canvas_px: int, logo_px: int) -> Image.Image:
    """Fit the logo into a logo_px box, centred on a transparent canvas."""
    w, h = logo.size
    scale = logo_px / max(w, h)
    sized = logo.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (canvas_px, canvas_px), (0, 0, 0, 0))
    canvas.paste(sized, ((canvas_px - sized.width) // 2, (canvas_px - sized.height) // 2), sized)
    return canvas


def main() -> None:
    logo = trimmed(Image.open(SRC).convert("RGBA"))
    mono = silhouette(logo)
    for name, d in DENSITIES.items():
        # Adaptive icon: 108dp canvas, 66dp safe zone — the logo takes ~58dp
        # of it so the ribbon's tips survive every mask shape.
        canvas = round(108 * d)
        mip = RES / f"mipmap-{name}"
        mip.mkdir(parents=True, exist_ok=True)
        centered(logo, canvas, round(58 * d)).save(mip / "ic_launcher_foreground.png", optimize=True)
        centered(mono, canvas, round(54 * d)).save(mip / "ic_launcher_monochrome.png", optimize=True)
        # Notification: 24dp with the standard 2dp padding.
        drw = RES / f"drawable-{name}"
        drw.mkdir(parents=True, exist_ok=True)
        centered(mono, round(24 * d), round(20 * d)).save(drw / "ic_notification.png", optimize=True)
    print("icons written to", RES)


if __name__ == "__main__":
    main()
