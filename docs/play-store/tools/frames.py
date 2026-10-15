"""Google Play phone screenshots for DEX: 1080x1920 (9:16), a headline, and the
app's real screen in a phone, with a card lifted out of it on some frames.

To redo them:
1. Render the screens.
   - Copy StoreShots.kt to
     android/app/src/test/java/com/chethan616/dex/ui/screens/session/.
   - Temporarily add the Robolectric test dependencies to app/build.gradle.kts
     (see the agent memory note android-screenshots-without-device).
   - Run, with DEX_SHOTS set to an empty folder:
     ./gradlew :app:testGithubDebugUnitTest --tests "*StoreShots*"
   - Revert the Gradle change and delete the copied test afterwards.
2. Download the Inter variable font (OFL) next to this file as Inter.ttf.
3. Run: python frames.py   (writes ../screenshots/)
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
# The screens rendered by StoreShots.kt (DEX_SHOTS), the Inter variable font
# (OFL; github.com/google/fonts ofl/inter), and where the frames go.
SHOTS = os.environ.get('DEX_SHOTS', os.path.join(HERE, 'store'))
INTER = os.environ.get('DEX_INTER', os.path.join(HERE, 'Inter.ttf'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'screenshots')
os.makedirs(OUT, exist_ok=True)
WORDMARK = os.path.join(REPO, 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi', 'dex_wordmark.webp')

W, H = 1080, 1920
SURFACE = (0x10, 0x12, 0x16)
ON_SURFACE = (0xE3, 0xE5, 0xEA)


def font(size, weight='Bold'):
    f = ImageFont.truetype(INTER, size)
    f.set_variation_by_name(weight)
    return f


def rounded_mask(size, r):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), r, fill=255)
    return m


def background(top, glow, glow2):
    """Deep navy, lit from above by the frame's colour."""
    bg = Image.new('RGB', (W, H))
    px = bg.load()
    bottom = (0x07, 0x0A, 0x12)
    for y in range(H):
        t = min(1.0, y / (H * 0.85))
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    bg = bg.convert('RGBA')
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((-260, -360, 760, 520), fill=glow + (120,))
    d.ellipse((560, 900, 1420, 1800), fill=glow2 + (70,))
    bg.alpha_composite(layer.filter(ImageFilter.GaussianBlur(160)))
    return bg


def status_bar(width, scale):
    """Android's status bar as on a phone, at the render's scale (3 px per dp)."""
    h = round(28 * scale)
    bar = Image.new('RGBA', (width, h), SURFACE + (255,))
    d = ImageDraw.Draw(bar)
    d.text((round(24 * scale), h // 2), '9:41', font=font(round(14 * scale), 'SemiBold'), fill=ON_SURFACE, anchor='lm')
    # punch-hole camera
    cx, cy, r = width // 2, h // 2, round(5.5 * scale)
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(0, 0, 0))
    # signal, Wi-Fi, battery
    x = width - round(24 * scale)
    bw, bh = round(22 * scale), round(11 * scale)
    d.rounded_rectangle((x - bw, cy - bh // 2, x, cy + bh // 2), round(3 * scale), outline=ON_SURFACE, width=max(2, round(1.2 * scale)))
    d.rounded_rectangle((x - bw + round(2 * scale), cy - bh // 2 + round(2 * scale), x - round(6 * scale), cy + bh // 2 - round(2 * scale)), round(1.5 * scale), fill=ON_SURFACE)
    x -= bw + round(8 * scale)
    for i, rr in enumerate((9, 6, 3)):
        R = round(rr * scale)
        d.arc((x - R - round(9 * scale), cy + round(4 * scale) - R, x + R - round(9 * scale), cy + round(4 * scale) + R), 225, 315, fill=ON_SURFACE, width=max(2, round(1.6 * scale)))
    x -= round(26 * scale)
    for i in range(4):
        bx = x - round((3 - i) * 4.5 * scale)
        top = cy + round(5 * scale) - round((i + 1) * 2.6 * scale)
        d.rectangle((bx, top, bx + round(3 * scale), cy + round(5 * scale)), fill=ON_SURFACE)
    return bar


def phone(render_path):
    """The screen (status bar + render) in a phone body, at its full render size."""
    screen = Image.open(render_path).convert('RGBA')
    scale = screen.width / 392  # px per dp
    bar = status_bar(screen.width, scale)
    full = Image.new('RGBA', (screen.width, bar.height + screen.height), SURFACE + (255,))
    full.alpha_composite(bar, (0, 0))
    full.alpha_composite(screen, (0, bar.height))
    bezel = round(14 * scale)
    body = Image.new('RGBA', (full.width + 2 * bezel, full.height + 2 * bezel), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    R = round(46 * scale)
    d.rounded_rectangle((0, 0, body.width - 1, body.height - 1), R, fill=(0x05, 0x06, 0x09, 255))
    d.rounded_rectangle((2, 2, body.width - 3, body.height - 3), R - 2, outline=(0x3A, 0x40, 0x4C, 255), width=4)
    full.putalpha(ImageChops.multiply(full.split()[-1], rounded_mask(full.size, R - bezel)))
    body.alpha_composite(full, (bezel, bezel))
    return body, bezel, bar.height


def shadow(img, blur=46, alpha=150, grow=0):
    a = img.split()[-1].point(lambda v: alpha if v > 0 else 0)
    s = Image.new('RGBA', (img.width + 4 * blur, img.height + 4 * blur), (0, 0, 0, 0))
    s.paste((0, 0, 0, 255), (2 * blur, 2 * blur), a)
    return s.filter(ImageFilter.GaussianBlur(blur))


def headline(img, lines, accent, sub, top=120):
    d = ImageDraw.Draw(img)
    f = font(86, 'ExtraBold')
    y = top
    for text, hl in lines:
        d.text((W // 2, y), text, font=f, fill=accent if hl else (255, 255, 255), anchor='ma')
        y += 100
    fs = font(36, 'Medium')
    y += 18
    words = sub.split()
    if d.textlength(sub, font=fs) <= 940:
        rows = [sub]
    else:
        # two lines of about the same length
        best = min(range(1, len(words)), key=lambda i: abs(d.textlength(' '.join(words[:i]), font=fs) - d.textlength(' '.join(words[i:]), font=fs)))
        rows = [' '.join(words[:best]), ' '.join(words[best:])]
    for r in rows:
        d.text((W // 2, y), r, font=fs, fill=(0xC6, 0xD2, 0xE6), anchor='ma'); y += 50
    y -= 50
    return y + 50


def frame(name, render, lines, sub, top, glow, glow2, accent, lift=None, lift_scale=1.08, wordmark=False):
    img = background(top, glow, glow2)
    head_top = 120
    if wordmark:
        wm = Image.open(WORDMARK).convert('RGBA')
        wm = wm.resize((round(wm.width * 86 / wm.height), 86), Image.LANCZOS)
        img.alpha_composite(wm, ((W - wm.width) // 2, 84))
        head_top = 206
    text_bottom = headline(img, lines, accent, sub, top=head_top)
    body, bezel, bar_h = phone(os.path.join(SHOTS, render))
    target_w = 800
    k = target_w / body.width
    body_s = body.resize((target_w, round(body.height * k)), Image.LANCZOS)
    px, py = (W - target_w) // 2, text_bottom + 56
    sh = shadow(body_s)
    img.alpha_composite(sh, (px - 92, py - 92 + 34))
    img.alpha_composite(body_s, (px, py))
    if lift:
        # A card from the screen, lifted out of the phone (render pixels: x0, y0, x1, y1, corner radius in dp).
        x0, y0, x1, y1, rdp = lift
        screen = Image.open(os.path.join(SHOTS, render)).convert('RGBA')
        scale = screen.width / 392
        card = screen.crop((x0, y0, x1, y1))
        card.putalpha(rounded_mask(card.size, round(rdp * scale)))
        cw = round(card.width * k * lift_scale)
        ch = round(card.height * k * lift_scale)
        card = card.resize((cw, ch), Image.LANCZOS)
        # where the card sits on the scaled phone, then grown about its centre
        cx = px + (bezel + (x0 + x1) / 2) * k
        cy = py + (bezel + bar_h + (y0 + y1) / 2) * k
        lx, ly = round(cx - cw / 2), round(cy - ch / 2)
        img.alpha_composite(shadow(card, blur=30, alpha=170), (lx - 60, ly - 60 + 22))
        edge = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        ImageDraw.Draw(edge).rounded_rectangle((0, 0, cw - 1, ch - 1), round(rdp * scale * k * lift_scale), outline=(255, 255, 255, 38), width=2)
        img.alpha_composite(card, (lx, ly))
        img.alpha_composite(edge, (lx, ly))
    img.convert('RGB').save(os.path.join(OUT, name), optimize=True)
    print('wrote', name)


BLUE, BLUE_TOP, BLUE_ACC = (0x2F, 0x6F, 0xDB), (0x13, 0x2C, 0x57), (0x9C, 0xCA, 0xFF)
VIOLET, VIOLET_TOP, VIOLET_ACC = (0x7B, 0x5C, 0xD6), (0x2A, 0x1E, 0x4F), (0xD8, 0xBD, 0xF6)
TEAL = (0x1F, 0xA2, 0xA8)

if __name__ == '__main__':
    frame('01-home.png', '1-home.png',
          [("Your PC's AI agent,", False), ('in your pocket', True)],
          'Start tasks from anywhere. Watch them happen.',
          BLUE_TOP, BLUE, VIOLET, BLUE_ACC, wordmark=True)
    frame('02-answers.png', '2-flights.png',
          [('Ask in plain words.', False), ('Tap the answer.', True)],
          'Flights, hotels and places, as cards you can tap.',
          VIOLET_TOP, VIOLET, BLUE, VIOLET_ACC, lift=(48, 1040, 1128, 1610, 22))
    frame('03-approve.png', '3-approval.png',
          [('Nothing risky', False), ('without your OK', True)],
          'DEX asks first. Approve from the notification.',
          BLUE_TOP, BLUE, TEAL, BLUE_ACC, lift=(36, 1212, 1140, 1728, 28))
    frame('04-routines.png', '4b-routine-graph.png',
          [('Routines that', False), ('run themselves', True)],
          'Say “every morning”. DEX takes it from there.',
          VIOLET_TOP, VIOLET, TEAL, VIOLET_ACC)
    frame('05-live.png', '5-live.png',
          [('Watch every step,', False), ('and steer it', True)],
          'See what DEX does on your PC as it happens.',
          BLUE_TOP, BLUE, VIOLET, BLUE_ACC)
