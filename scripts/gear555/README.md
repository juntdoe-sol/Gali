# Gear 555 sprites

Every Gear 555 item is drawn in Python on the game's own miner rig (`scripts/actors_miner.py`), so gear
shares the miner's shading, ink outline and proportions.

- `kit.py`: runs the rig and dresses it (`Top`, `Bottom`, `Shoe`, `Weapon`; pets use the rig's `Frame`)
- `heads_all.py`, `tops.py`, `bottoms.py`, `shoes.py`, `weapons.py`, `pets.py`: one module per slot,
  `ITEMS = [(id, name, rarity, fn)]` in catalogue order
- `catalogue.json`: the 555 items (name, slot, rarity, set, art note, flavor, supply)
- `legend_hats.py`: the Jarl Helmet (Founding Miner reward)
- `build_market.py`: packs `app/assets/market/` (thumbnail atlas on a silhouette miner, Legendary
  animation strips, `gear555.json` for the Market)
- `preview.py`: review sheets, e.g. `python3 -I preview.py tops sheets/tops-1.png 0 24`

Rebuild the Market art after changing a sprite:

```
python3 -I scripts/gear555/build_market.py
```
