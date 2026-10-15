"""README images for DEX: the hero (the desktop app with the phone in front of
it) and the desktop frames. The desktop screens are the hub rendered in a
headless browser with sample data (desk-shots/capture.mjs); the phone screen
is StoreShots.kt's. Writes to docs/images/readme/.

  DEX_DESK_SHOTS=<capture.mjs out dir> DEX_SHOTS=<StoreShots renders> python readme_frames.py
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import frames as F

HERE = os.path.dirname(os.path.abspath(__file__))
DESK = os.environ.get('DEX_DESK_SHOTS', os.path.join(HERE, 'desk'))
OUT = os.path.join(F.REPO, 'docs', 'images', 'readme')
os.makedirs(OUT, exist_ok=True)
ICON = os.path.join(F.REPO, 'docs', 'play-store', 'icon-512.png')
# Where capture.mjs found the cards to lift (screenshot pixels, plus the corner radius).
import json
_boxes_path = os.path.join(DESK, 'boxes.json')
BOXES = json.load(open(_boxes_path)) if os.path.exists(_boxes_path) else {}


def box(name, radius=None):
    b = BOXES.get(name)
    if not b:
        return None
    x0, y0, x1, y1, r = b
    return (round(x0), round(y0), round(x1), round(y1), round(radius if radius is not None else r))


def background(w, h, top, glow, glow2):
    bg = Image.new('RGB', (w, h))
    px = bg.load()
    bottom = (0x07, 0x0A, 0x12)
    for y in range(h):
        t = min(1.0, y / (h * 0.9))
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    bg = bg.convert('RGBA')
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((-w * 0.15, -h * 0.45, w * 0.55, h * 0.45), fill=glow + (120,))
    d.ellipse((w * 0.55, h * 0.35, w * 1.25, h * 1.2), fill=glow2 + (80,))
    bg.alpha_composite(layer.filter(ImageFilter.GaussianBlur(220)))
    return bg


def window(shot_path, width):
    """The screenshot in a Windows-style window: a title bar with DEX's icon and caption buttons."""
    shot = Image.open(shot_path).convert('RGBA')
    k = width / shot.width
    shot = shot.resize((width, round(shot.height * k)), Image.LANCZOS)
    bar_h = round(width * 0.024)
    win = Image.new('RGBA', (width, bar_h + shot.height), (0x0D, 0x0E, 0x11, 255))
    d = ImageDraw.Draw(win)
    icon = Image.open(ICON).convert('RGBA').resize((round(bar_h * 0.56),) * 2, Image.LANCZOS)
    m = F.rounded_mask(icon.size, round(icon.width * 0.22))
    icon.putalpha(ImageChops.multiply(icon.split()[-1], m))
    win.alpha_composite(icon, (round(bar_h * 0.45), (bar_h - icon.height) // 2))
    d.text((round(bar_h * 0.45) + icon.width + round(bar_h * 0.3), bar_h // 2), 'DEX', font=F.font(round(bar_h * 0.36), 'SemiBold'), fill=(0xC9, 0xCE, 0xD8), anchor='lm')
    g = (0x9A, 0xA1, 0xAE)
    cy, s = bar_h // 2, round(bar_h * 0.16)
    x = width - round(bar_h * 0.75)
    lw = max(2, round(bar_h * 0.035))
    d.line((x - s, cy - s, x + s, cy + s), fill=g, width=lw); d.line((x - s, cy + s, x + s, cy - s), fill=g, width=lw)
    x -= round(bar_h * 1.4)
    d.rectangle((x - s, cy - s, x + s, cy + s), outline=g, width=lw)
    x -= round(bar_h * 1.4)
    d.line((x - s, cy, x + s, cy), fill=g, width=lw)
    win.alpha_composite(shot, (0, bar_h))
    r = round(width * 0.011)
    win.putalpha(F.rounded_mask(win.size, r))
    edge = Image.new('RGBA', win.size, (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle((0, 0, win.width - 1, win.height - 1), r, outline=(0x3A, 0x40, 0x4C, 255), width=2)
    win.alpha_composite(edge)
    return win, k, bar_h


def headline_line(img, y, parts, size, sub, sub_size):
    """One centred line in two tones, and the line under it."""
    d = ImageDraw.Draw(img)
    f = F.font(size, 'ExtraBold')
    total = sum(d.textlength(t, font=f) for t, _ in parts)
    x = (img.width - total) / 2
    for t, colour in parts:
        d.text((x, y), t, font=f, fill=colour)
        x += d.textlength(t, font=f)
    fs = F.font(sub_size, 'Medium')
    d.text((img.width // 2, y + round(size * 1.28)), sub, font=fs, fill=(0xC6, 0xD2, 0xE6), anchor='ma')
    return y + round(size * 1.28) + round(sub_size * 1.5)


def desk_frame(name, shot, parts, sub, top, glow, glow2, lift=None):
    W, H = 2400, 1500
    img = background(W, H, top, glow, glow2)
    y = headline_line(img, 110, parts, 92, sub, 42)
    win, k, bar_h = window(os.path.join(DESK, shot), 2000)
    x0, y0 = (W - win.width) // 2, y + 50
    img.alpha_composite(F.shadow(win, blur=60, alpha=170), (x0 - 120, y0 - 120 + 40))
    img.alpha_composite(win, (x0, y0))
    if lift:
        lx0, ly0, lx1, ly1, r = lift
        src = Image.open(os.path.join(DESK, shot)).convert('RGBA').crop((lx0, ly0, lx1, ly1))
        src.putalpha(F.rounded_mask(src.size, r))
        grow = 1.05
        cw, ch = round(src.width * k * grow), round(src.height * k * grow)
        card = src.resize((cw, ch), Image.LANCZOS)
        cx = x0 + (lx0 + lx1) / 2 * k
        cy = y0 + bar_h + (ly0 + ly1) / 2 * k
        px, py = round(cx - cw / 2), round(cy - ch / 2)
        img.alpha_composite(F.shadow(card, blur=40, alpha=190), (px - 80, py - 80 + 30))
        img.alpha_composite(card, (px, py))
        edge = Image.new('RGBA', card.size, (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle((0, 0, cw - 1, ch - 1), round(r * k * grow), outline=(255, 255, 255, 46), width=2)
        img.alpha_composite(edge, (px, py))
    img.convert('RGB').save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)


def hero():
    W, H = 2400, 1420
    img = background(W, H, F.BLUE_TOP, F.BLUE, F.VIOLET)
    wm = Image.open(F.WORDMARK).convert('RGBA')
    wm = wm.resize((round(wm.width * 96 / wm.height), 96), Image.LANCZOS)
    img.alpha_composite(wm, ((W - wm.width) // 2, 70))
    y = headline_line(img, 196, [('Your AI agent on your PC, ', (255, 255, 255)), ('and in your pocket', F.BLUE_ACC)], 84,
                      'Free and open source. It works in your browser, files, apps and accounts while you keep working.', 40)
    win, k, bar_h = window(os.path.join(DESK, 'flights.png'), 1900)
    x0, y0 = 110, y + 50
    img.alpha_composite(F.shadow(win, blur=60, alpha=170), (x0 - 120, y0 - 120 + 40))
    img.alpha_composite(win, (x0, y0))
    body, bezel, bar = F.phone(os.path.join(F.SHOTS, '1-home.png'))
    pw = 560
    body = body.resize((pw, round(body.height * pw / body.width)), Image.LANCZOS)
    px, py = W - pw - 90, y0 + 150
    img.alpha_composite(F.shadow(body, blur=50, alpha=190), (px - 100, py - 100 + 36))
    img.alpha_composite(body, (px, py))
    img.convert('RGB').save(os.path.join(OUT, 'hero.png'), optimize=True)
    print('wrote hero.png')


if __name__ == '__main__':
    hero()
    desk_frame('desktop-answers.png', 'flights.png', [('Ask in plain words. ', (255, 255, 255)), ('Tap the answer.', F.VIOLET_ACC)],
               'Flights, hotels and places come back as cards with Select and Open.', F.VIOLET_TOP, F.VIOLET, F.BLUE,
               lift=box('flights', 24))
    desk_frame('desktop-approve.png', 'approval.png', [('Nothing risky ', (255, 255, 255)), ('without your OK', F.BLUE_ACC)],
               'DEX says what kind of step it is and waits. Approve once, for this turn, or for the task.', F.BLUE_TOP, F.BLUE, F.TEAL,
               lift=box('approval'))
    desk_frame('desktop-routines.png', 'routines.png', [('Routines that ', (255, 255, 255)), ('run themselves', F.VIOLET_ACC)],
               'Say "every morning" or "every Sunday". DEX saves it, runs it, and shows it as a graph.', F.VIOLET_TOP, F.VIOLET, F.TEAL)
    desk_frame('desktop-connectors.png', 'marketplace.png', [('50+ connectors, ', (255, 255, 255)), ('one sign-in each', F.BLUE_ACC)],
               'Google, GitHub, Notion, Slack, Canva and more. DEX uses their APIs, not their web pages.', F.BLUE_TOP, F.BLUE, F.VIOLET)
    desk_frame('desktop-dashboard.png', 'dashboard.png', [('Every task ', (255, 255, 255)), ('at a glance', F.BLUE_ACC)],
               'What is running, what is waiting for you, and everything DEX finished.', F.VIOLET_TOP, F.VIOLET, F.BLUE)
