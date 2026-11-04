# Gali 3D cartoon short

A 10-second, 16:9 3D cartoon. The Gali miner walks onto ORE Island at dusk with his gold pickaxe on his
shoulder. He cracks a glowing ORE rock in three swings, it bursts into gold and teal gems, he jumps for joy
and the GALI wordmark pops in with "MINE ORE. MAKE IT A GAME."

Everything is built from code: `build_scene.py` makes the whole scene in Blender (models, materials,
lights, camera, every keyframe), and `sfx.py` synthesises the score and sound effects. Nothing is sampled
except `../public/wordmark.png`.

Needs Blender 5.2 and FFmpeg.

    BLENDER=/Applications/Blender.app/Contents/MacOS/Blender

    # test frames at half size -> out/stills/
    $BLENDER -b --factory-startup --python build_scene.py -- out stills 66 122 230

    # full render, 240 PNG frames -> out/frames/, plus out/gali_cartoon.blend
    $BLENDER -b --factory-startup --python build_scene.py -- out anim

    python3 sfx.py out/gali_cartoon.wav
    ffmpeg -framerate 24 -i out/frames/f_%04d.png -i out/gali_cartoon.wav \
      -c:v libx264 -pix_fmt yuv420p -crf 17 -c:a aac -b:a 192k -shortest out/gali-cartoon-16x9.mp4

For phones (9:16, 1080x1920), set `GALI_ASPECT=v`. It uses a wider lens and writes `out/frames_v/`,
`out/stills_v/` and `out/gali_cartoon_v.blend`:

    GALI_ASPECT=v $BLENDER -b --factory-startup --python build_scene.py -- out anim
    ffmpeg -framerate 24 -i out/frames_v/f_%04d.png -i out/gali_cartoon.wav \
      -c:v libx264 -pix_fmt yuv420p -crf 17 -c:a aac -b:a 192k -shortest out/gali-cartoon-9x16.mp4

To check that no hand, arm or part of the pickaxe passes through the head or helmet in any frame
(prints `CLIPS 0` when clean):

    $BLENDER -b --factory-startup --python build_scene.py -- out check

He swings with his right hand, out at the side beyond the helmet brim, and his left arm moves freely.
A two-handed grip in front of the chest can't go overhead without passing through the head.

Timeline (24 fps): walk-in 1-44, swings hit at 66, 92 and 122 (the burst), jumps at 140 and 164,
wordmark at 152, tagline at 168. `sfx.py` uses the same frame numbers, so if you move a beat in
one file, move it in the other.

Open `out/gali_cartoon.blend` in Blender to tweak a pose, light or camera by hand.
