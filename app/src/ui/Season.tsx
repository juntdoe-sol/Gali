/**
 * Hollow Night in the interface: a flickering pixel jack-o'-lantern, the season badge with its countdown,
 * cobwebs for window corners, and the once-a-season welcome. Looks only: nothing here changes a number.
 */
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { HOLLOW, IS_HOLLOW, seasonLeft } from '../game/season';
import { play } from '../game/sfx';
import { useGame } from '../game/store';
import { Btn, ModalCenter, PixelBox, Scrim, T, Window } from './kit';

/** Pixel art from rows of characters: each run of one colour in a row is one View. */
export function PixelArt({ rows, palette, px }: { rows: string[]; palette: Record<string, string>; px: number }) {
  const w = rows[0].length;
  return (
    <View style={{ width: w * px, height: rows.length * px }} pointerEvents="none">
      {rows.flatMap((row, y) => {
        const runs: JSX.Element[] = [];
        let x = 0;
        while (x < w) {
          const ch = row[x];
          let e = x + 1;
          while (e < w && row[e] === ch) e++;
          const col = palette[ch];
          if (col) runs.push(<View key={`${y}.${x}`} style={{ position: 'absolute', left: x * px, top: y * px, width: (e - x) * px, height: px, backgroundColor: col }} />);
          x = e;
        }
        return runs;
      })}
    </View>
  );
}

const PUMPKIN = ['....gg...', '...gg....', '.ooOoOoo.', 'oooOoOooo', 'oyyOoOyyo', 'oooOyOooo', 'oyoyyyoyo', 'ooyoyoyoo', '.ooOoOoo.'];

/** A jack-o'-lantern whose face flickers like a candle. */
export function Pumpkin({ px = 3 }: { px?: number }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setLit((v) => (v + 1) % 6), 110);
    return () => clearInterval(id);
  }, []);
  const face = ['#ffd64a', '#ffe27a', '#ffc23a', '#fff0a0', '#ffcf4a', '#ffb13a'][lit];
  return <PixelArt rows={PUMPKIN} palette={{ g: '#4f8a2c', o: '#e8741c', O: '#b4520e', y: face }} px={px} />;
}

const WEB = ['x.....x...', '.x...x....', '..x.x.....', 'xxxxx.....', '..x.x.....', '.x...x....', 'x.....x...'];
/** A cobweb for a window's top-left corner. */
export function Cobweb({ px = 2 }: { px?: number }) {
  if (!IS_HOLLOW) return null;
  return (
    <View style={styles.web} pointerEvents="none">
      <PixelArt rows={WEB} palette={{ x: 'rgba(235,230,255,0.38)' }} px={px} />
    </View>
  );
}

/** "HOLLOW NIGHT · 8d 14h left" with a flickering pumpkin. Renders nothing outside the season. */
export function HollowBadge({ compact }: { compact?: boolean }) {
  const [left, setLeft] = useState(seasonLeft());
  useEffect(() => {
    const id = setInterval(() => setLeft(seasonLeft()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!IS_HOLLOW) return null;
  return (
    <PixelBox fill="rgba(30,10,46,0.92)" hi="#ff8a1e" lo="#3a1258" shadow={1} style={[styles.badge, compact && { paddingHorizontal: 8, gap: 6 }]}>
      <Pumpkin px={compact ? 2 : 3} />
      <View>
        <T v="display" style={{ fontSize: compact ? 15 : 18, lineHeight: compact ? 16 : 19, color: '#ffa62b', letterSpacing: 1 }}>
          {HOLLOW.name}
        </T>
        <T v="label" style={{ fontSize: compact ? 10 : 11, lineHeight: compact ? 11 : 12, color: '#c9b8ff' }}>
          {left ? `${left} left` : 'Last night'}
        </T>
      </View>
    </PixelBox>
  );
}

/** Shown once per season per device: the island has gone dark. */
export function HollowSplash() {
  const seen = useGame((s) => s.save.seasonSeen);
  const loaded = useGame((s) => s.loaded);
  const mark = useGame((s) => s.markSeason);
  const open = IS_HOLLOW && loaded && seen !== HOLLOW.id;
  useEffect(() => {
    if (open) play('rumble');
  }, [open]);
  if (!open) return null;
  const close = () => {
    play('door');
    mark(HOLLOW.id);
  };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Scrim onPress={close}>
        <ModalCenter>
          <Window title="HOLLOW NIGHT" sub={`The season runs until 5 Nov · ${seasonLeft()} left`} accent="#ff8a1e" width={460}>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 14, paddingVertical: 8 }}>
              <Pumpkin px={4} />
              <Pumpkin px={6} />
              <Pumpkin px={4} />
            </View>
            <T v="display" style={{ textAlign: 'center', fontSize: 22, lineHeight: 24, color: '#ffa62b' }}>
              The sun has not come up on Gali Island.
            </T>
            <View style={{ gap: 6, marginTop: 10 }}>
              {[
                ['Endless night', 'The island and the lobby stay under the moon all season.'],
                ['Jack-o’-lanterns', 'Every spot and every lamp has one burning.'],
                ['Things in the dark', 'Bats, will-o’-the-wisps, and a ghost that wanders past.'],
                ['The Hollow Night theme', 'New music in the lobby. Turn it off in your profile.'],
              ].map(([h, b]) => (
                <View key={h} style={styles.row}>
                  <T v="black" style={{ color: '#8dff7a', fontSize: 14 }}>{h}</T>
                  <T v="muted" style={{ fontSize: 13, flex: 1, textAlign: 'right' }}>{b}</T>
                </View>
              ))}
            </View>
            <T v="muted" style={{ textAlign: 'center', fontSize: 12, marginTop: 10 }}>
              Only the look changes. Rounds, odds and rewards work as always.
            </T>
            <Btn kind="gold" label="ENTER IF YOU DARE" onPress={close} style={{ marginTop: 12 }} />
          </Window>
        </ModalCenter>
      </Scrim>
    </Modal>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, height: 40 },
  web: { position: 'absolute', left: 6, top: 6, opacity: 0.9 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'baseline', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(6,3,14,0.55)' },
});
