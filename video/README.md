# GALI intro video

A 30-second motion piece built from the real game engine plus a motion-graphics layer.

    npx esbuild src/main.ts --bundle --outfile=public/main.js --loader:.json=json --target=es2020
    node /root/perf/serve.mjs public 4800 &          # any static server that serves ./public
    python3 soundtrack.py score.wav                  # original chiptune score + SFX
    node render.mjs 1080 1920 v.mp4                  # 9:16
    node render.mjs 1920 1080 h.mp4                  # 16:9
    ffmpeg -i v.mp4 -i score.wav -c:v copy -c:a aac -b:a 192k -shortest out-9x16.mp4

`src/clock.ts` replaces the page clock so every frame is exactly 1/30 s apart; the timeline
(cues, step cards, counters) lives in `src/main.ts`.
