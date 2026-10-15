/**
 * An animated Gali sticker: a strip of 8 pixel frames (assets/stickers, made by scripts/stickers.py)
 * stepped by one shared clock, so a chat full of stickers costs one timer.
 */
import { useEffect, useState } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';

export const STICKER_SRC: Record<string, ImageSourcePropType> = {
  gm: require('../../assets/stickers/gm.png'),
  gn: require('../../assets/stickers/gn.png'),
  letsmine: require('../../assets/stickers/letsmine.png'),
  lfg: require('../../assets/stickers/lfg.png'),
  gold: require('../../assets/stickers/gold.png'),
  rekt: require('../../assets/stickers/rekt.png'),
  wagmi: require('../../assets/stickers/wagmi.png'),
  gg: require('../../assets/stickers/gg.png'),
  bonk: require('../../assets/stickers/bonk.png'),
  motherlode: require('../../assets/stickers/motherlode.png'),
};
const FRAMES = 8;
const FRAME_MS = 130;

let frame = 0;
const subs = new Set<(f: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function useFrame(on: boolean) {
  const [f, setF] = useState(0);
  useEffect(() => {
    if (!on) return;
    subs.add(setF);
    if (!timer)
      timer = setInterval(() => {
        frame = (frame + 1) % FRAMES;
        subs.forEach((s) => s(frame));
      }, FRAME_MS);
    return () => {
      subs.delete(setF);
      if (!subs.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [on]);
  return on ? f : 0;
}

export function Sticker({ id, size = 96, still }: { id: string; size?: number; still?: boolean }) {
  const f = useFrame(!still);
  const src = STICKER_SRC[id];
  if (!src) return null;
  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }} accessibilityLabel={`${id} sticker`}>
      <Image source={src} style={{ position: 'absolute', left: -f * size, top: 0, width: size * FRAMES, height: size }} resizeMode="stretch" />
    </View>
  );
}
