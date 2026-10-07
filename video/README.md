# Gali intro video

An 89-second motion piece in two formats, 9:16 and 16:9. The island, the lobby and Cave Run are the real
game engines from `../app/src/engine`, driven by a script: a scripted round on the island, a scripted
crowd in the lobby, and a small bot holding the controls in the cave. A motion-graphics layer (step
cards, counters, the mini game explainers, transitions) is drawn on top.

    npm install
    npm run render:v                                   # 9:16  -> out/gali-v.mp4
    npm run render:h                                   # 16:9  -> out/gali-h.mp4
    python3 soundtrack.py out/score-v.wav out/gali-v.events.json
    ffmpeg -i out/gali-v.mp4 -i out/score-v.wav -c:v libx264 -c:a aac -shortest out/gali-intro-9x16.mp4

Stills for checking a frame: `node render.mjs 1920 1080 --stills 243 551` writes `out/still-*.jpg`.
Set `CHROMIUM_PATH` to use a browser already installed; otherwise run `npx playwright install chromium`.

- `src/clock.ts` replaces the page clock, so every frame is exactly 1/30 s apart and every render is identical.
- `src/timeline.ts` holds the timeline on a beat grid (111.1 BPM, one beat = one pickaxe swing).
- `src/main.ts` is the island and the frame loop; `src/town.ts` the lobby; `src/dig.ts` Cave Run;
  `src/games.ts` the three mini game cards; `src/kit.ts` the shared drawing helpers.
- `render.mjs` writes `<name>.events.json` beside the video: every pickaxe hit the engine drew.
  `soundtrack.py` reads it, so the clinks in the score land on the swings.
- The score is synthesised in numpy and scipy. Nothing is sampled.
