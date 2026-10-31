/**
 * BrawlOre: the new Brawl Arena (plan: project doc claude/gali-brawl-arena-v2.md). A simple platform fighter:
 * knock miners off the stage, 3 lives each. Step 1: 1v1 or a 4-miner free-for-all against bots.
 *
 * The fight runs in the canvas (pixel/BrawlOreView, engine/brawlore.ts); this screen is the menu around it and
 * the results. It opens where the old arena opened (useArena.open) while the `?brawlore=1` test flag is on.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useArena } from '../game/arena';
import { play, type Sound } from '../game/sfx';
import { useName } from '../game/username';
import type { BrawlEvent, BrawlResult } from '../engine/brawlore';
import type { Difficulty, Mode } from '../game/brawl2/sim';
import { atlasSource } from '../pixel/atlasSource';
import BrawlOreView, { type BrawlOreRef } from '../pixel/BrawlOreView';
import { myLook } from '../pixel/PixelMine';
import { Btn, Choice, PixelBox, T } from './kit';
import { LANDSCAPE_APP, useLayout } from './layout';

/** On while BrawlOre is being tested: `?brawlore=1` on the web. */
export const BRAWLORE = Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]brawlore=1\b/.test(window.location?.search ?? '');

const SFX: Record<string, Sound> = { swing: 'dig', hit: 'bonk', slam: 'crack', ko: 'ko', cheer: 'win', pop: 'pop', pick: 'pop', throw: 'dig' };
const ORD = ['', '1ST', '2ND', '3RD', '4TH'];
const DIFF: [Difficulty, string, string][] = [
  ['easy', 'EASY', 'Slow bots, good to learn'],
  ['normal', 'NORMAL', 'A fair fight'],
  ['hard', 'HARD', 'Fast, smart, mean'],
];

export function BrawlOreScreen() {
  const insets = useSafeAreaInsets();
  const L = useLayout();
  const open = useArena((s) => s.open);
  const name = useName((s) => s.name);
  const ref = useRef<BrawlOreRef>(null);
  const [atlas, setAtlas] = useState<string | null>(null);
  const [stage, setStage] = useState<'menu' | 'fight' | 'done'>('menu');
  const [mode, setMode] = useState<Mode>('1v1');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [result, setResult] = useState<BrawlResult | null>(null);
  const touch = !L.desktop || LANDSCAPE_APP;
  // a phone held sideways is short: a smaller menu that scrolls
  const short = L.h < 480;

  useEffect(() => {
    if (open && !atlas) atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
    if (!open) setStage('menu');
  }, [open, atlas]);

  const fight = () => {
    setResult(null);
    setStage('fight');
    ref.current?.begin({ mode, diff, name: name || 'You', look: myLook(), weapon: 'pick' });
  };
  const onEvent = (e: BrawlEvent) => {
    if (e.t === 'sfx') play(SFX[e.name] ?? 'pop');
    else if (e.t === 'end') {
      setResult(e.result);
      setStage('done');
    } else if (e.t === 'menu') {
      ref.current?.quit();
      setStage('menu');
    }
  };
  if (!open) return null;
  const exit = () => {
    ref.current?.quit();
    useArena.getState().close();
  };

  return (
    <Modal visible transparent={false} animationType="fade" statusBarTranslucent onRequestClose={exit}>
      <View style={[styles.screen, LANDSCAPE_APP && { marginLeft: insets.left, marginRight: insets.right }]}>
        {atlas ? (
          <BrawlOreView
            ref={ref}
            onEvent={onEvent}
            atlas={atlas}
            touch={touch}
            dom={{ style: { flex: 1, backgroundColor: '#0b0712' }, scrollEnabled: false, nestedScrollEnabled: false, bounces: false, overScrollMode: 'never' } as never}
          />
        ) : null}
        {/* always reachable: back to the menu during a fight, out of the arena from the menu */}
        <View style={[styles.corner, { top: insets.top + 8, left: 10 }]} pointerEvents="box-none">
          <Btn small kind="ghost" label={stage === 'fight' ? 'QUIT' : 'LOBBY'} onPress={stage === 'fight' ? () => onEvent({ t: 'menu' }) : exit} />
        </View>
        {stage === 'menu' ? (
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.center, { paddingVertical: short ? 6 : 12 }]}>
            <PixelBox fill="rgba(12,8,24,0.94)" hi={COLORS.gold} lo="#04060f" shadow={1} style={[styles.card, short && { gap: 6, padding: 10 }]}>
              <T v="display" style={[styles.logo, short && { fontSize: 26, lineHeight: 28 }]}>
                BRAWLORE
              </T>
              {short ? null : <T style={{ textAlign: 'center', fontSize: 13 }}>Knock miners off the stage. Hits raise their damage %, and the higher it is, the further they fly. 3 lives each.</T>}
              <T v="label" style={styles.lbl}>
                MATCH
              </T>
              <View style={styles.row}>
                <Choice label="1 V 1" sub="You and one bot" on={mode === '1v1'} onPress={() => setMode('1v1')} />
                <Choice label="FREE FOR ALL" sub="You and 3 bots" on={mode === 'ffa'} onPress={() => setMode('ffa')} />
              </View>
              <T v="label" style={styles.lbl}>
                BOTS
              </T>
              <View style={styles.row}>
                {DIFF.map(([d, l, s]) => (
                  <Choice key={d} label={l} sub={s} on={diff === d} onPress={() => setDiff(d)} />
                ))}
              </View>
              <Btn kind="gold" label="FIGHT" onPress={fight} />
              <T v="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                {touch
                  ? 'Left thumb: move. Right: JUMP, LIGHT, HEAVY, DODGE. Hold down + a button to aim down. HEAVY in the air without down flies you up.'
                  : 'A/D move · W or Space jump · S down · J or left click light · K or right click heavy · L or Shift dodge. Heavy in the air flies you up; down + heavy slams.'}
              </T>
              <T v="muted" style={{ fontSize: 11, textAlign: 'center', color: COLORS.teal }}>
                Online matches with other miners are coming next.
              </T>
            </PixelBox>
          </ScrollView>
        ) : null}
        {stage === 'done' && result ? (
          <View style={styles.centerAbs} pointerEvents="box-none">
            <PixelBox fill="rgba(12,8,24,0.95)" hi={result.place === 1 ? COLORS.gold : '#3a2c50'} lo="#04060f" shadow={1} style={styles.card}>
              <T v="display" style={[styles.logo, { color: result.place === 1 ? COLORS.gold : COLORS.text }]}>
                {result.place === 1 ? 'YOU WIN!' : `${ORD[result.place] ?? result.place} PLACE`}
              </T>
              {result.table.map((r) => (
                <View key={r.name + r.place} style={[styles.res, r.you && { backgroundColor: 'rgba(255,201,60,0.12)' }]}>
                  <T v="display" style={{ width: 44, color: r.place === 1 ? COLORS.gold : COLORS.text, fontSize: 18 }}>
                    {ORD[r.place] ?? r.place}
                  </T>
                  <T v="bold" style={{ flex: 1 }}>
                    {r.you ? `${r.name} (you)` : r.name}
                  </T>
                  <T v="muted">
                    {r.kos} KO · {r.falls} falls
                  </T>
                </View>
              ))}
              <View style={styles.row}>
                <Btn kind="gold" label="REMATCH" onPress={fight} style={{ flex: 1 }} />
                <Btn kind="plain" label="MENU" onPress={() => setStage('menu')} style={{ flex: 1 }} />
              </View>
            </PixelBox>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0712' },
  corner: { position: 'absolute', zIndex: 5 },
  scroll: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  centerAbs: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 12 },
  card: { width: 460, maxWidth: '100%', padding: 16, gap: 10 },
  logo: { fontSize: 36, lineHeight: 38, color: COLORS.gold, textAlign: 'center', letterSpacing: 2 },
  lbl: { color: COLORS.teal, marginTop: 2 },
  row: { flexDirection: 'row', gap: 8 },
  res: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 6 },
});
