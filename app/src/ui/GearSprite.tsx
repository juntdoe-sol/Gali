/**
 * One Gear 555 item as pixel art, cut from the thumbnail atlas. Legendary items play their 8-frame
 * loop (the "GIF" on the Market card) when `animate` is on.
 */
import { useEffect, useState } from 'react';
import { Image, View, type ImageStyle } from 'react-native';
import { ANIM, ANIM_SIZE, CELL, COLS, THUMBS, THUMBS_SIZE, type GearItem } from '../game/gear555';

const PIX = { imageRendering: 'pixelated' } as ImageStyle;
/** One shared clock for every animated card, so a grid of Legendaries stays in step. */
let frame = 0;
const subs = new Set<(f: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function tick(cb: (f: number) => void) {
  subs.add(cb);
  if (!timer)
    timer = setInterval(() => {
      frame = (frame + 1) % 8;
      for (const s of subs) s(frame);
    }, 130);
  return () => {
    subs.delete(cb);
    if (!subs.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function GearSprite({ item, scale = 2, animate = false }: { item: GearItem; scale?: number; animate?: boolean }) {
  const anim = animate && item.anim !== null;
  const [f, setF] = useState(frame);
  useEffect(() => (anim ? tick(setF) : undefined), [anim]);
  const s = CELL * scale;
  const [x, y, src, size] = anim
    ? [f * CELL, (item.anim as number) * CELL, ANIM, ANIM_SIZE]
    : [(item.thumb % COLS) * CELL, Math.floor(item.thumb / COLS) * CELL, THUMBS, THUMBS_SIZE];
  return (
    <View style={{ width: s, height: s, overflow: 'hidden' }} accessibilityLabel={item.name}>
      <Image
        source={src}
        fadeDuration={0}
        style={[{ position: 'absolute', left: -x * scale, top: -y * scale, width: size[0] * scale, height: size[1] * scale }, PIX]}
      />
    </View>
  );
}
