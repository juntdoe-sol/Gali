/**
 * "MOTHERLODE HIT!" for everyone online, wherever they are (island, lobby, cave, arena) and whether or not they
 * played that round. The server's ore-hits job records every motherlode ORE's board pays (public.ore_lodes); the
 * game checks once a minute and shows each new one once, naming the Gali miners who shared it.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { oreLive } from '../chain/light';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { publicKey, restBase } from '../game/world';
import { announce, play } from '../game/sfx';
import { fmtOreAmt } from '../game/pot';
import { PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import { TOP_H, useLayout } from './layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Lode { roundId: number; ore: number; miners: number; at: string; gali: { wallet: string; name: string | null; ore: number | null }[] }
const SEEN_KEY = 'gali:lode-seen';
const FRESH_MS = 10 * 60_000; // only shout about hits from the last 10 minutes
const POLL_MS = 60_000;
const SHOW_MS = 14_000;

async function fetchLodes(): Promise<Lode[]> {
  const base = restBase();
  if (!base) return [];
  const r = await fetch(`${base}/rest/v1/rpc/gali_motherlodes`, {
    method: 'POST',
    headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_limit: 3 }),
  });
  if (!r.ok) return [];
  const rows = (await r.json()) as Record<string, unknown>[];
  return rows.map((x) => ({
    roundId: Number(x.round_id), ore: Number(x.ore) || 0, miners: Number(x.miners) || 0, at: String(x.at),
    gali: Array.isArray(x.gali) ? (x.gali as Lode['gali']) : [],
  }));
}

export function MotherlodeAlert() {
  const owner = useGame((s) => s.wallet.owner);
  const { desktop } = useLayout();
  const insets = useSafeAreaInsets();
  const [lode, setLode] = useState<Lode | null>(null);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (!oreLive) return;
    let alive = true;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      try {
        if (seen.current === null) seen.current = Number((await AsyncStorage.getItem(SEEN_KEY)) ?? 0) || 0;
        const list = await fetchLodes();
        const fresh = list.filter((l) => l.roundId > (seen.current ?? 0) && Date.now() - Date.parse(l.at) < FRESH_MS);
        if (!alive) return;
        const top = list[0];
        if (top && top.roundId > (seen.current ?? 0)) {
          seen.current = top.roundId;
          void AsyncStorage.setItem(SEEN_KEY, String(top.roundId));
        }
        if (fresh.length) {
          setLode(fresh[0]);
          play('motherlode');
          announce('motherlode');
          clearTimeout(hide);
          hide = setTimeout(() => alive && setLode(null), SHOW_MS);
        }
      } catch {
        /* try again next minute */
      }
    };
    const first = setTimeout(check, 3000);
    const id = setInterval(check, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
      clearTimeout(hide);
    };
  }, []);

  if (!lode) return null;
  const mine = lode.gali.find((g) => g.wallet === owner);
  const others = lode.gali.filter((g) => g.wallet !== owner);
  const who = (g: Lode['gali'][number]) => `${g.name || `${g.wallet.slice(0, 4)}…`}${g.ore ? ` +${fmtOreAmt(g.ore)}` : ''}`;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: desktop ? TOP_H + 10 : insets.top + 64 }]}>
      <Pressable onPress={() => setLode(null)} accessibilityRole="alert" accessibilityLabel={`Motherlode hit. ${fmtOreAmt(lode.ore)} ORE paid on round ${lode.roundId}. Tap to close.`}>
        <PixelBox fill="#2a1d00" hi="#ffe9a8" lo="#7a3d06" edge="#04060f" shadow={3} style={[styles.box, desktop && { maxWidth: 560 }]}>
          <View style={styles.head}>
            <PixIcon name="ore" size={26} />
            <T v="display" style={styles.title}>
              MOTHERLODE HIT!
            </T>
            <PixIcon name="ore" size={26} />
          </View>
          <T v="num" style={styles.big}>
            {fmtOreAmt(lode.ore)} ORE
          </T>
          <T v="num" style={styles.line}>
            Round #{(lode.roundId % 100000).toLocaleString()} · shared by {lode.miners} miner{lode.miners === 1 ? '' : 's'} on the gold spot
          </T>
          {mine ? (
            <T v="num" style={[styles.line, { color: COLORS.green, fontSize: 18 }]}>
              You were on it! {mine.ore ? `+${fmtOreAmt(mine.ore)} ORE` : 'Your share lands in Unclaimed.'}
            </T>
          ) : null}
          {others.length ? (
            <T v="num" style={[styles.line, { color: COLORS.teal }]}>
              Gali miners on it: {others.slice(0, 4).map(who).join(', ')}
              {others.length > 4 ? ` and ${others.length - 4} more` : ''}
            </T>
          ) : mine ? null : (
            <T v="num" style={[styles.line, { color: COLORS.muted }]}>
              No Gali miner on the gold spot this time. It starts filling up again now.
            </T>
          )}
        </PixelBox>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 60, paddingHorizontal: 12 },
  box: { paddingHorizontal: 18, paddingVertical: 12, alignItems: 'center', gap: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { fontSize: 30, lineHeight: 32, color: COLORS.gold, letterSpacing: 2 },
  big: { fontSize: 34, lineHeight: 36, color: '#ffffff' },
  line: { fontSize: 16, lineHeight: 18, color: '#ffe9a8', textAlign: 'center' },
});
