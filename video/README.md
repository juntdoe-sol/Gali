# Gali intro video

A 44-second motion piece in two formats, 9:16 and 16:9. The island, the miners, the water and the
dive underground are the real game engine from `../app/src/engine`, driven by a scripted round.
A motion-graphics layer (step cards, counters, transitions) is drawn on top.

    npm install
    npm run render:v                                   # 9:16  -> out/gali-v.mp4
    npm run render:h                                   # 16:9  -> out/gali-h.mp4
    python3 soundtrack.py out/score-v.wav out/gali-v.events.json
    ffmpeg -i out/gali-v.mp4 -i out/score-v.wav -c:v libx264 -c:a aac -shortest out/gali-intro-9x16.mp4

Stills for checking a frame: `node render.mjs 1920 1080 --stills 243 551` writes `out/still-*.jpg`.
Set `CHROMIUM_PATH` to use a browser already installed; otherwise run `npx playwright install chromium`.

- `src/clock.ts` replaces the page clock, so every frame is exactly 1/30 s apart and every render is identical.
- `src/main.ts` holds the timeline on a beat grid (111.1 BPM, one beat = one pickaxe swing).
- `render.mjs` writes `<name>.events.json` beside the video: every pickaxe hit the engine drew.
  `soundtrack.py` reads it, so the clinks in the score land on the swings.
- The score is synthesised in numpy and scipy. Nothing is sampled.
