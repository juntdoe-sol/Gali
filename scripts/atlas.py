"""One texture for the whole game.

Every sprite is drawn at 1x (one art pixel = one pixel here) and packed into
app/assets/pixel/atlas.png. The engine scales at draw time with smoothing off, so
nothing is pre-scaled and the download is a fraction of what 150 separate 4x PNGs
cost. app/src/engine/art.json carries the rectangles and anchors.

Naming contract (the engine looks these up by name):

  ground                      the island's land, sea transparent
  claim-<i>-fill|edge         white masks the engine tints, per claim
  icon-<kind>                 claim marker, anchored at its foot
  ship-<kind>, bird-<0|1>, islet-<kind>
  prop-<name>-<frame>         trees, rocks, huts... anchored at their foot
  miner-<pose>-<f>-<layer>    layers: base, fit, fit-shade, pick, pick-shade;
                              base is the body, the rest are white masks + shading
  hat-<key>                   helmet per gear key, anchored at the head point
  pet-<key>-<f>               pet per gear key
  mole-<f>, fx-<name>-<f>     effects
  font                        bitmap font strip (see font meta)

Anchors are the point the engine positions: feet for things that stand, the
head point for hats, the centre for effects.
"""
from PIL import Image


class Atlas:
    def __init__(self):
        self.items = {}

    def add(self, name, img, ax=0, ay=0):
        if name in self.items:
            raise SystemExit(f'atlas: duplicate sprite {name}')
        img = img.convert('RGBA')
        self.items[name] = (img, int(ax), int(ay))

    def has(self, name):
        return name in self.items

    def pack(self, path, width=1024, pad=1):
        """Shelf packing, tallest first. Plenty for a few hundred small sprites."""
        order = sorted(self.items.items(), key=lambda kv: (-kv[1][0].height, -kv[1][0].width, kv[0]))
        rects = {}
        x = y = shelf = 0
        for name, (img, ax, ay) in order:
            w, h = img.width, img.height
            if x + w + pad > width:
                x, y, shelf = 0, y + shelf + pad, 0
            rects[name] = [x, y, w, h, ax, ay]
            x += w + pad
            shelf = max(shelf, h)
        height = y + shelf
        # a power-of-two height keeps older GPUs happy
        ph = 1
        while ph < height:
            ph *= 2
        sheet = Image.new('RGBA', (width, ph), (0, 0, 0, 0))
        for name, (img, _ax, _ay) in self.items.items():
            r = rects[name]
            sheet.paste(img, (r[0], r[1]))
        sheet.save(path, optimize=True)
        return rects, [width, ph]
