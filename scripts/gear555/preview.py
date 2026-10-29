"""Preview sheet for one slot module.

usage: python3 -I preview.py MODULE OUT.png [start] [count]
MODULE exposes SLOT ('head','top','bottom','shoe','weapon','pet') and
ITEMS = [(gid, name, rarity, fn)]. fn() returns the gear piece for that slot
(for 'head' a Hat object or (img, ax, ay); for 'pet' a function t -> image).
"""
import importlib
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, HERE)
import kit  # noqa: E402

FONTS = f'{HERE}/fonts'
RAR = {'Common': (169, 163, 180), 'Uncommon': (106, 212, 111), 'Rare': (79, 214, 239), 'Legendary': (255, 200, 61)}

mod = importlib.import_module(sys.argv[1])
OUT = sys.argv[2]
start = int(sys.argv[3]) if len(sys.argv) > 3 else 0
count = int(sys.argv[4]) if len(sys.argv) > 4 else len(mod.ITEMS)
items = mod.ITEMS[start:start + count]
SLOT = mod.SLOT
S = 5

# which frames to show per slot
FRAMES = {
    'head': [('idle', 0), ('cheer', 2)],
    'top': [('idle', 0), ('walk', 1)],
    'bottom': [('idle', 0), ('walk', 2)],
    'shoe': [('idle', 0), ('walk', 2)],
    'weapon': [('idle', 0), ('swing', 2), ('swing', 5)],
    'pet': [('idle', 0)],
}[SLOT]


def piece(fn):
    v = fn()
    if SLOT == 'head' and hasattr(v, 'finish'):
        img, ax, ay = v.finish()
        return (img, ax, ay)
    return v


cell_w = kit.CW * S
cell_h = kit.CH * S
pets = SLOT == 'pet'
nf = len(FRAMES) + (1 if pets else 0)
card_w = cell_w * nf if not pets else cell_w + 26 * S
card_h = cell_h + 64
COLS = max(1, 1400 // (card_w + 16))
rows = (len(items) + COLS - 1) // COLS
W = COLS * (card_w + 16) + 16
H = rows * (card_h + 16) + 16
sheet = Image.new('RGB', (W, H), (18, 12, 24))
d = ImageDraw.Draw(sheet)
fn_ = ImageFont.truetype(f'{FONTS}/PixelifySans_700Bold.ttf', 22)
ft = ImageFont.truetype(f'{FONTS}/Silkscreen_400Regular.ttf', 14)
bad = []
for i, (gid, name, rar, fn) in enumerate(items):
    x0 = 16 + (i % COLS) * (card_w + 16)
    y0 = 16 + (i // COLS) * (card_h + 16)
    col = RAR[rar]
    d.rectangle((x0, y0, x0 + card_w, y0 + card_h), fill=(34, 24, 44), outline=col, width=3)
    try:
        if pets:
            pf = fn
            img, (ax, ay) = kit.render({}, 'idle', 0)
            img = img.resize((cell_w, cell_h), Image.NEAREST)
            sheet.paste(img, (x0, y0), img)
            p = pf(0)
            p = p.resize((p.width * S, p.height * S), Image.NEAREST)
            px = x0 + cell_w - 10 * S
            py = y0 + (ay + 1) * S - p.height
            sheet.paste(p, (px, py), p)
            p2 = pf(2).resize((p.width, p.height), Image.NEAREST) if pf(2).size == pf(0).size else None
            if p2:
                sheet.paste(p2, (px + p.width + 2 * S, py), p2)
        else:
            gear = {SLOT: piece(fn)}
            for k, (pose, t) in enumerate(FRAMES):
                img, _ = kit.render(gear, pose, t)
                img = img.resize((cell_w, cell_h), Image.NEAREST)
                sheet.paste(img, (x0 + k * cell_w, y0), img)
    except Exception as e:  # keep going, list failures
        bad.append((gid, repr(e)))
        d.text((x0 + 10, y0 + 40), 'ERROR', font=fn_, fill=(255, 80, 80))
    d.text((x0 + 10, y0 + card_h - 54), name, font=fn_, fill=(246, 234, 206))
    d.text((x0 + 10, y0 + card_h - 24), f'{gid}  {rar.upper()}', font=ft, fill=col)
sheet.save(OUT)
print(OUT, sheet.size, 'errors:', bad)
