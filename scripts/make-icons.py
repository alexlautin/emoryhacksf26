#!/usr/bin/env python3
"""Make the desktop app's icons and installer art from the brand pug (public/ui/pug.png).

    python3 scripts/make-icons.py

Needs Pillow (pip install pillow). Run it after changing the pug art; it overwrites:

  src-tauri/icons/icon.icns, icon.ico, icon.png, 32x32.png, 64x64.png, 128x128.png, 128x128@2x.png
      The app icon: the pug on a deep teal tile. macOS gets the rounded tile with margin and shadow
      that Mac icons use; Windows gets a tile that fills the square.
  src-tauri/icons/tray/ok-template.png, alert-template.png
      macOS menu bar: the pug's line art in black, which macOS tints for light and dark menu bars.
      The alert version adds a dot.
  src-tauri/icons/tray/ok-color.png, alert-color.png
      Windows tray: the pug in color; the alert version adds a red dot.
  src-tauri/icons/dmg-background.png (and .tiff with a Retina copy, on macOS)
      The window you see when you open the DMG: drag Harness into Applications.
  src-tauri/icons/nsis-header.bmp, nsis-sidebar.bmp
      The Windows installer's header and its welcome/finish page sidebar.
"""
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'src-tauri', 'icons')
PUG = os.path.join(ROOT, 'public', 'ui', 'pug.png')
FONT = os.path.join(ROOT, 'public', 'ui', 'fonts', 'instrument-sans-latin-wght-normal.woff2')

INK = (13, 16, 18)
PAPER = (251, 250, 247)
MUTED = (98, 109, 116)
TEAL_TOP = (22, 128, 111)
TEAL_BOTTOM = (10, 76, 67)


def pug():
    im = Image.open(PUG).convert('RGBA')
    return im.crop(im.getbbox())


def font(size, weight='Regular'):
    f = ImageFont.truetype(FONT, size)
    try:
        f.set_variation_by_name(weight)
    except Exception:
        pass
    return f


def gradient(size, top, bottom):
    w, h = size
    col = Image.new('RGB', (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        col.putpixel((0, y), tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return col.resize((w, h))


def glow(size, center, radius, alpha):
    """A soft white light, for the top of the tile."""
    w, h = size
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    cx, cy = center
    d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=alpha)
    return m.filter(ImageFilter.GaussianBlur(radius * 0.45))


def fit(im, width=None, height=None):
    w, h = im.size
    s = (width / w) if width else (height / h)
    return im.resize((round(w * s), round(h * s)), Image.LANCZOS)


# ---------------------------------------------------------------- app icon

def tile(size, box, radius, shadow):
    """A teal rounded tile with the pug standing on it. Drawn at 2x, then scaled down."""
    S = 2
    W = size * S
    x0, y0, x1, y1 = [v * S for v in box]
    canvas = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle((x0, y0, x1, y1), radius * S, fill=255)

    if shadow:
        sh = mask.copy().filter(ImageFilter.GaussianBlur(14 * S))
        sh = ImageChops.offset(sh, 0, 10 * S).point(lambda v: round(v * 0.38))
        canvas.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (W, W), 0)] * 3, sh)))

    bg = gradient((W, W), TEAL_TOP, TEAL_BOTTOM).convert('RGBA')
    light = glow((W, W), (W // 2, y0 + (y1 - y0) * 0.18), (x1 - x0) * 0.42, 46)
    bg = Image.composite(Image.new('RGBA', (W, W), (255, 255, 255, 255)), bg, light)
    t = (x1 - x0)
    # Ground shadow under the feet.
    feet_y = y0 + t * 0.835
    sh = Image.new('L', (W, W), 0)
    ImageDraw.Draw(sh).ellipse((W / 2 - t * 0.30, feet_y - t * 0.022, W / 2 + t * 0.30, feet_y + t * 0.03), fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(t * 0.018))
    bg.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (W, W), 0)] * 3, sh)))
    # The pug, centered, feet on the shadow.
    p = fit(pug(), width=round(t * 0.74))
    bg.alpha_composite(p, (round(W / 2 - p.width / 2 - t * 0.01), round(feet_y - p.height + t * 0.012)))
    # A hairline at the edge, so the tile reads on dark docks too.
    edge = Image.new('L', (W, W), 0)
    ImageDraw.Draw(edge).rounded_rectangle((x0, y0, x1, y1), radius * S, outline=40, width=2 * S)
    bg = Image.composite(Image.new('RGBA', (W, W), (255, 255, 255, 255)), bg, edge)

    canvas.paste(bg, (0, 0), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def app_icons(out):
    mac = tile(1024, (100, 100, 924, 924), 185, shadow=True)
    win = tile(1024, (24, 24, 1000, 1000), 210, shadow=False)
    mac.save(os.path.join(out, 'icon-mac-1024.png'))
    win.save(os.path.join(out, 'icon-win-1024.png'))

    mac.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, 'icon.png'))
    for name, s in [('32x32.png', 32), ('64x64.png', 64), ('128x128.png', 128), ('128x128@2x.png', 256)]:
        mac.resize((s, s), Image.LANCZOS).save(os.path.join(ICONS, name))
    mac.save(os.path.join(ICONS, 'icon.icns'), sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)])
    win.save(os.path.join(ICONS, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


# ---------------------------------------------------------------- tray

def tray_icons():
    src = pug()
    a = src.getchannel('A')
    lum = ImageOps.grayscale(src.convert('RGB'))
    # The line art: the dark outline, ears and mask. Thickened a touch so it survives 22pt.
    ink = ImageChops.multiply(lum.point(lambda v: 255 if v < 90 else 0), a.point(lambda v: 255 if v > 100 else 0))
    ink = ink.filter(ImageFilter.MaxFilter(9))

    def place(mask, size=44, pad=2, dx=0, dy=0, scale=1.0):
        m = mask.copy()
        m.thumbnail((round((size - 2 * pad) * scale),) * 2, Image.LANCZOS)
        out = Image.new('L', (size, size), 0)
        out.paste(m, ((size - m.width) // 2 + dx, (size - m.height) // 2 + dy))
        return out

    def badge(mask, cx=37.5, cy=6.5, r=5.5, gap=2.5):
        d = Image.new('L', mask.size, 0)
        ImageDraw.Draw(d).ellipse((cx - r - gap, cy - r - gap, cx + r + gap, cy + r + gap), fill=255)
        mask = ImageChops.subtract(mask, d)
        ImageDraw.Draw(mask).ellipse((cx - r, cy - r, cx + r, cy + r), fill=255)
        return mask

    def template(mask):
        return Image.merge('RGBA', (*[Image.new('L', mask.size, 0)] * 3, mask))

    tray = os.path.join(ICONS, 'tray')
    template(place(ink)).save(os.path.join(tray, 'ok-template.png'))
    template(badge(place(ink, dx=-4, dy=5, scale=0.8))).save(os.path.join(tray, 'alert-template.png'))

    def color(alert):
        size = 44
        p = src.copy()
        p.thumbnail((40 if not alert else 33,) * 2, Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.alpha_composite(p, ((size - p.width) // 2 - (4 if alert else 0), (size - p.height) // 2 + (5 if alert else 0)))
        if alert:
            d = ImageDraw.Draw(out)
            d.ellipse((30, -1, 45, 14), fill=(255, 255, 255, 255))
            d.ellipse((32, 1, 43, 12), fill=(229, 72, 77, 255))
        return out

    color(False).save(os.path.join(tray, 'ok-color.png'))
    color(True).save(os.path.join(tray, 'alert-color.png'))


# ---------------------------------------------------------------- DMG window

ICON_Y = 190  # where Finder centers the two icons (see dmg in tauri.conf.json)


def arrow(d, x0, x1, y, s, color):
    """A gentle arc from the app to the Applications folder, ending in a head along the curve."""
    import math
    lift = 22 * s
    pts = []
    for i in range(61):
        t = i / 60
        pts.append((x0 + (x1 - x0) * t, y - lift * 4 * t * (1 - t)))
    head = 11 * s
    ex, ey = pts[-1]
    px, py = pts[-4]
    ang = math.atan2(ey - py, ex - px)
    # Stop the line short of the tip so the head stays sharp.
    stop = [q for q in pts if math.hypot(q[0] - ex, q[1] - ey) > head * 0.8]
    d.line(stop, fill=color, width=round(2.5 * s), joint='curve')
    left = (ex - head * math.cos(ang - 0.5), ey - head * math.sin(ang - 0.5))
    right = (ex - head * math.cos(ang + 0.5), ey - head * math.sin(ang + 0.5))
    d.polygon([(ex, ey), left, right], fill=color)


def dmg_background(scale):
    s = scale
    W, H = 660 * s, 400 * s
    im = gradient((W, H), PAPER, (243, 241, 234)).convert('RGBA')
    d = ImageDraw.Draw(im)
    # Brand row at the top
    p = fit(pug(), height=round(34 * s))
    title = font(round(22 * s), 'Bold')
    tw = d.textlength('Harness', font=title)
    gap = 10 * s
    total = p.width + gap + tw
    x = (W - total) / 2
    im.alpha_composite(p, (round(x), round(34 * s)))
    d.text((x + p.width + gap, 51 * s), 'Harness', font=title, fill=INK, anchor='lm')
    sub = font(round(13 * s))
    d.text((W / 2, 86 * s), 'Drag Harness into Applications to install it.', font=sub, fill=MUTED, anchor='mm')
    # Arrow between the two icons (Finder draws them at x=180 and x=480).
    arrow(d, 262 * s, 398 * s, ICON_Y * s, s, (176, 170, 157))
    small = font(round(12 * s))
    d.text((W / 2, 352 * s), 'Then open it from Applications. It lives in your menu bar.', font=small, fill=MUTED, anchor='mm')
    return im.convert('RGB')


def dmg(out):
    big = dmg_background(4)
    one = big.resize((660, 400), Image.LANCZOS)
    two = big.resize((1320, 800), Image.LANCZOS)
    one.save(os.path.join(ICONS, 'dmg-background.png'))
    two.save(os.path.join(out, 'dmg-background@2x.png'))
    # A two-resolution TIFF keeps the window sharp on Retina screens. macOS only.
    if shutil.which('tiffutil'):
        a = os.path.join(out, 'bg.png')
        b = os.path.join(out, 'bg@2x.png')
        one.save(a)
        two.save(b)
        subprocess.run(['tiffutil', '-cathidpicheck', a, b, '-out', os.path.join(ICONS, 'dmg-background.tiff')], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------------------------------------------------------------- Windows installer

def nsis():
    S = 3
    # Sidebar on the welcome and finish pages: 164 x 314.
    W, H = 164 * S, 314 * S
    im = gradient((W, H), TEAL_TOP, TEAL_BOTTOM).convert('RGBA')
    light = glow((W, H), (W // 2, round(H * 0.32)), W * 0.55, 40)
    im = Image.composite(Image.new('RGBA', (W, H), (255, 255, 255, 255)), im, light)
    p = fit(pug(), width=round(118 * S))
    feet = round(170 * S)
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).ellipse((W / 2 - 50 * S, feet - 4 * S, W / 2 + 50 * S, feet + 6 * S), fill=80)
    im.alpha_composite(Image.merge('RGBA', (*[Image.new('L', (W, H), 0)] * 3, sh.filter(ImageFilter.GaussianBlur(4 * S)))))
    im.alpha_composite(p, (round(W / 2 - p.width / 2), feet - p.height + 2 * S))
    d = ImageDraw.Draw(im)
    d.text((W / 2, 206 * S), 'Harness', font=font(22 * S, 'Bold'), fill=(255, 255, 255), anchor='mm')
    f = font(round(10.5 * S))
    for i, line in enumerate(['Watches what AI coding', 'agents do on your computer.']):
        d.text((W / 2, (232 + i * 15) * S), line, font=f, fill=(214, 236, 232), anchor='mm')
    im.convert('RGB').resize((164, 314), Image.LANCZOS).save(os.path.join(ICONS, 'nsis-sidebar.bmp'))

    # Header strip on the inner pages: 150 x 57, on the installer's white header.
    W, H = 150 * S, 57 * S
    im = Image.new('RGBA', (W, H), (255, 255, 255, 255))
    p = fit(pug(), height=round(40 * S))
    d = ImageDraw.Draw(im)
    title = font(15 * S, 'Bold')
    tw = d.textlength('Harness', font=title)
    gap = 7 * S
    x = (W - (p.width + gap + tw)) / 2
    im.alpha_composite(p, (round(x), round((H - p.height) / 2)))
    d.text((x + p.width + gap, H / 2), 'Harness', font=title, fill=INK, anchor='lm')
    im.convert('RGB').resize((150, 57), Image.LANCZOS).save(os.path.join(ICONS, 'nsis-header.bmp'))


def main():
    with tempfile.TemporaryDirectory() as out:
        app_icons(out)
        tray_icons()
        dmg(out)
        nsis()
        keep = os.environ.get('HARNESS_ICON_PREVIEW')
        if keep:
            os.makedirs(keep, exist_ok=True)
            for f in os.listdir(out):
                shutil.copy(os.path.join(out, f), keep)
    print('Icons and installer art written to src-tauri/icons.')


if __name__ == '__main__':
    main()
