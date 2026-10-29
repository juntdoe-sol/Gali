# Gali Gear 555: sprite brief (shared by all slot agents)

Gali is a pixel-art Solana mining game. Every gear item is drawn as real pixel art
on the game's own miner rig. The user approved the style of `legend/legend_hats.py`
(the Jarl Helmet) and `gear/heads.py` (16 head items): hand-placed pixels, 5-tone
colour ramps lit from the TOP LEFT, a 1px dark ink outline, chunky readable shapes,
strong silhouettes, a few highlight pixels. The user rejected the old catalogue icons
as "ugly" (flat generic shapes). Quality bar: every item must read clearly as the
named thing at 1x on a 20x26 miner, and look like it belongs in a polished pixel game.

Folder: /tmp/claude-0/-home-claude/4a667279-6b4d-5d36-81cd-07a66db1f133/scratchpad
- gear/catalogue.json: all 555 items (id, name, slot, rarity, set, art note, flavor).
  Draw what the name + art note describe. Keep items in catalogue order.
- gear/kit.py: the drawing kit (READ IT FIRST). Do NOT edit kit.py, examples.py,
  heads.py or preview.py; other agents use them. Put helpers in your own module.
- gear/examples.py: one or two worked examples per slot.
- gear/preview.py: renders a sheet: `python3 -I preview.py <module> <out.png> [start] [count]`
  run from inside gear/ (cd gear && python3 -I preview.py tops sheets/tops-1.png 0 24).
- legend/legend_hats.py: Hat class + helpers (ramp5, mix, gem, brim_shadow).
- The game repo is at /tmp/gali (read only). scripts/actors_miner.py is the rig,
  scripts/actors_kit.py the Frame class and RAMPS, scripts/actors_critters.py the pets.

Rules
- Always run python as `python3 -I`. Don't fetch anything from the network.
- Your module exposes SLOT and ITEMS = [(gid, name, rarity, fn), ...] covering EVERY
  catalogue item of your slot, in catalogue order, using the catalogue's exact id/name/rarity.
- Rarity must be visible in the art: Common = simple, one or two colours, clean;
  Uncommon = a detail or pattern; Rare = distinctive shape + accent colours + a glint;
  Legendary = big silhouette, gold/glow/effects, the most detail. Static frames are fine;
  if an item has an animation note, draw its most expressive frame.
- Funny is the point: the jokes are crypto/Solana/NFT culture (rugs, jeets, paper hands,
  diamond hands, wen, gm, ser, probably nothing, bonding curves, liquidation, rent exempt,
  priority fees, blockhash expired, whales, shrimp, monke, frogs, hat dog, durian, teh tarik,
  Nusantara/Malaysian items). Make the joke readable in the pixels.
- No real brand logos, real project mascots, real people or copyrighted characters.
  "Nods" only (a dog in a pink knit hat is fine; a real logo is not).
- Colours: never pure black outlines inside shapes (use the ramp's dark tones); keep the
  ink outline from the kit. Avoid muddy mid-greys; pick saturated, game-palette colours.
- Self-review: render sheets of ~16-24 items, LOOK at every sheet with the Read tool,
  and redo anything that doesn't read as the named item, is mostly hidden, clips badly,
  or looks flat. Iterate until every item passes. This is the main job.
- When done, write sheets covering all your items to gear/sheets/<slot>-<n>.png and report:
  the module path, the sheet paths, the item count, and any items you think are still weak.
