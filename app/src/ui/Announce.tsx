// Team announcements from the admin page (galiadmin.bounded.page > Game > Announcements).
// Reads game_announcements through Supabase REST with the public key; the row policy only returns
// announcements that are on and inside their start/end window. A player can close one; it stays closed.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { COLORS } from '../game/constants';
import { publicKey, restBase } from '../game/world';
import { PixelBox, T } from './kit';

type Ann = { id: number; kind: 'info' | 'event' | 'warn' | 'maintenance'; text: string; link: string | null };
const LOOK: Record<Ann['kind'], { label: string; fill: string; hi: string; tag: string; fg: string }> = {
  info: { label: 'NEWS', fill: 'rgba(42,29,0,0.92)', hi: COLORS.gold, tag: COLORS.gold, fg: '#2a1400' },
  event: { label: 'EVENT', fill: 'rgba(42,10,29,0.92)', hi: '#ff7ac8', tag: '#ff7ac8', fg: '#2a0a1d' },
  warn: { label: 'HEADS UP', fill: 'rgba(42,19,0,0.92)', hi: '#ff9d2e', tag: '#ff9d2e', fg: '#2a1400' },
  maintenance: { label: 'MAINTENANCE', fill: 'rgba(42,6,9,0.92)', hi: COLORS.red, tag: COLORS.red, fg: '#fff' },
};
const SEEN = 'gali-ann-closed';

export function AnnounceBanner({ top, left = 0, right = 0 }: { top: number; left?: number; right?: number }) {
  const [list, setList] = useState<Ann[]>([]);
  const [closed, setClosed] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SEEN).then((v) => { if (alive && v) setClosed(JSON.parse(v)); }).catch(() => {});
    const load = async () => {
      const base = restBase(), key = publicKey();
      if (!base || !key) return;
      try {
        const r = await fetch(`${base}/rest/v1/game_announcements?select=id,kind,text,link&order=id.desc&limit=3`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        if (r.ok && alive) setList(await r.json());
      } catch { /* offline: keep what we have */ }
    };
    void load();
    const t = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const a = list.find((x) => !closed.includes(x.id));
  if (!a) return null;
  const look = LOOK[a.kind] ?? LOOK.info;
  const close = () => {
    const next = [...closed, a.id].slice(-30);
    setClosed(next);
    AsyncStorage.setItem(SEEN, JSON.stringify(next)).catch(() => {});
  };
  return (
    <View style={{ position: 'absolute', top, left: left + 8, right: right + 8, alignItems: 'center' }} pointerEvents="box-none">
      <PixelBox fill={look.fill} hi={look.hi} lo="#04060f" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 10, maxWidth: 560 }}>
        <View style={{ backgroundColor: look.tag, paddingHorizontal: 5, paddingVertical: 1 }}>
          <T v="display" style={{ fontSize: 13, color: look.fg }}>{look.label}</T>
        </View>
        <Pressable style={{ flexShrink: 1 }} disabled={!a.link} onPress={() => a.link && Linking.openURL(a.link)} accessibilityRole={a.link ? 'link' : 'text'}>
          <T v="bold" style={{ fontSize: 13 }} numberOfLines={3}>
            {a.text}
            {a.link ? <T v="bold" style={{ fontSize: 13, color: COLORS.gold }}>{'  OPEN >'}</T> : null}
          </T>
        </Pressable>
        <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close announcement">
          <T v="display" style={{ fontSize: 16, color: COLORS.text }}>X</T>
        </Pressable>
      </PixelBox>
    </View>
  );
}
