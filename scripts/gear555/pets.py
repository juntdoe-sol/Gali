"""Gali Gear 555, pet slot: 92 pets, each a 4-frame idle loop fn(t) -> RGBA.
Drawn with the rig's Frame kit (pets_lib), outlined like the game's own pets.
Commons in pets_common, Uncommons in pets_uncommon, Rares in pets_rare,
Legendaries in pets_legend."""
import json
import sys

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import pets_lib  # noqa: E402,F401
import examples  # noqa: E402

SLOT = 'pet'
_FNS = {}
for _m in ('pets_common', 'pets_uncommon', 'pets_rare', 'pets_legend'):
    try:
        mod = __import__(_m)
    except ModuleNotFoundError:
        continue
    for k, v in vars(mod).items():
        if k.startswith('ITEMS_'):
            _FNS.update(v)

_CAT = json.load(open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'catalogue.json')))
ITEMS = [(i['id'], i['name'], i['rarity'], _FNS.get(i['id'], examples.pet_slime))
         for i in _CAT if i['slot'] == 'Pet']
MISSING = [i[0] for i in ITEMS if i[0] not in _FNS]
