"""Characters: the miner (layered so gear can recolour it), helmets, pets, the
wild mole, and the shop's gear icons.

build(atlas) adds every sprite to the atlas, writes the gear icons to
app/assets/gear/ + app/src/ui/gearIcons.ts, and returns the `actors` block of
art.json:

miner
  w, h        frame size (20x26). Every layer of every frame shares it.
  ax, ay      feet anchor: bottom centre, on the boot-sole row.
  poses       {pose: {n, ms, loop}}   sprite names: miner-<pose>-<f>-<layer>
  layers      base, fit, fit-shade, pick, pick-shade
                base        full colour body, pick handle, and the whole outline
                fit         white mask of the overalls, tint with the outfit colour
                fit-shade   folds/straps/buttons drawn over the tinted overalls
                pick        white mask of the pick head, tint with the pickaxe accent
                pick-shade  highlights/shadow + ink ring over the tinted pick head
              The masks never overlap each other or the base, so each layer is
              self-contained.
  order       draw order: base, fit, fit-shade, then the hat, then pick,
              pick-shade (the pick passes in front of the hat on the strike and
              the cheer).
  hit         swing frame where the pick lands.
  impact      [x, y] in frame coords: where the pick tip meets the ground on `hit`.
  head        {pose: [[x, y] per frame]}: top-centre of the skull; put the hat's
              anchor here.
hats          {key: {ax, ay, lamp}}  sprite hat-<key> (key already starts 'hat-');
              lamp is the lens centre relative to the anchor, or null.
pets          {key: {n, ms, fly, ax, ay, light}}  sprites pet-<name>-<f>;
              ax/ay: feet for walkers, centre for flyers. light is a hex or null.
mole          {up: [names], idle: [names], bonk, ax, ay}  anchor = hole centre.
"""
import os

import actors_critters
import actors_hats
import actors_icons
import actors_miner as M

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYERS = ['base', 'fit', 'fit-shade', 'pick', 'pick-shade']
LOOP = {'idle': True, 'walk': True, 'swing': False, 'cheer': False, 'carry': True}


def impact_point(frames):
    """Where the buried pick tip meets the ground on the hit frame (lowest pick
    head pixels, measured from the mask)."""
    px = frames['swing'][M.HIT]['pick'].load()
    rows = {}
    for y in range(M.H):
        for x in range(M.W):
            if px[x, y][3]:
                rows.setdefault(y, []).append(x)
    y = max(rows)
    return [int(round(sum(rows[y]) / len(rows[y]))), y]


def build(atlas):
    # ---- miner
    frames, heads = M.build_miner()
    poses = {}
    for pose, seq in frames.items():
        for t, layers in enumerate(seq):
            for name in LAYERS:
                atlas.add(f'miner-{pose}-{t}-{name}', layers[name], M.AX, M.AY)
        poses[pose] = {'n': len(seq), 'ms': M.POSES[pose], 'loop': LOOP[pose]}

    # ---- helmets
    hats = actors_hats.build_hats()
    hat_meta = {}
    for key, (img, ax, ay, lamp) in hats.items():
        atlas.add(key, img, ax, ay)
        hat_meta[key] = {'ax': ax, 'ay': ay, 'lamp': lamp}

    # ---- pets
    pets = actors_critters.build_pets()
    pet_meta = {}
    for key, p in pets.items():
        for t, img in enumerate(p['frames']):
            atlas.add(f'{key}-{t}', img, p['ax'], p['ay'])
        pet_meta[key] = {'n': len(p['frames']), 'ms': p['ms'], 'fly': p['fly'],
                         'ax': p['ax'], 'ay': p['ay'], 'light': p['light']}

    # ---- wild mole
    mole = actors_critters.build_mole()
    for i, img in enumerate(mole['frames']):
        atlas.add(f'mole-{i}', img, mole['ax'], mole['ay'])
    atlas.add('mole-bonk', mole['bonk'], mole['ax'], mole['ay'])
    mole_meta = {'up': ['mole-0', 'mole-1', 'mole-2'], 'idle': ['mole-3', 'mole-4'], 'bonk': 'mole-bonk',
                 'ax': mole['ax'], 'ay': mole['ay'], 'ms': 90, 'idleMs': 260}

    # ---- shop icons (React Native assets, not the atlas)
    gear = actors_icons.read_gear(ROOT)
    actors_icons.write_icons(actors_icons.build_icons(gear, hats, pets), ROOT)

    return {
        'miner': {'w': M.W, 'h': M.H, 'ax': M.AX, 'ay': M.AY, 'poses': poses, 'hit': M.HIT,
                  'impact': impact_point(frames), 'head': heads, 'layers': LAYERS,
                  'order': ['base', 'fit', 'fit-shade', 'hat', 'pick', 'pick-shade']},
        'hats': hat_meta,
        'pets': pet_meta,
        'mole': mole_meta,
    }
