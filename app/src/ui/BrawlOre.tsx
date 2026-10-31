/**
 * Gali Fightclub: the new Brawl Arena (plan: project doc claude/gali-brawl-arena-v2.md). A simple platform fighter
 * in a fight pit under the mine: knock miners off the ring, 3 lives each. 1v1 or a 4-miner free-for-all, online
 * with other miners (game/brawl2/online.ts) or against bots. Each weapon brings a special move
 * (game/brawl2/specials.ts), used when the meter is full.
 *
 * The fight runs in the canvas (pixel/BrawlOreView, engine/brawlore.ts); this screen is the menu around it and
 * the results. It opens where the old arena opened (useArena.open) while the test flag is on
 * (`?fightclub=1`, or the older `?brawlore=1`).
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, gearByKey } from '../game/constants';
import { useArena } from '../game/arena';
import { play, type Sound } from '../game/sfx';
import { useName } from '../game/username';
import { useGame } from '../game/store';
import { cancel, endMatch, FFA_WAIT_MS, leaveOnline, onNet, queueList, search, sendNet, SOLO_WAIT_MS, startRoom, useOnline, type Queue } from '../game/brawl2/online';
import { cleanCode, newCode } from '../game/brawl2/net';
import { SPECIAL_INFO, specialOf } from '../game/brawl2/specials';
import type { BrawlEvent, BrawlResult } from '../engine/brawlore';
import type { Difficulty, Mode } from '../game/brawl2/sim';
import { atlasSource } from '../pixel/atlasSource';
import BrawlOreView, { type BrawlOreRef } from '../pixel/BrawlOreView';
import { myLook } from '../pixel/PixelMine';
import { Btn, Choice, PixelBox, T } from './kit';
import { MineAnywhere, useMinePanel } from './MineAnywhere';
import { LANDSCAPE_APP, useLayout } from './layout';

/** On while Gali Fightclub is being tested: `?fightclub=1` (or the older `?brawlore=1`) on the web. */
export const BRAWLORE = Platform.OS === 'web' && typeof window !== 'undefined' && /[?&](fightclub|brawlore)=1\b/.test(window.location?.search ?? '');

const SFX: Record<string, Sound> = { swing: 'dig', hit: 'bonk', slam: 'crack', ko: 'ko', cheer: 'win', pop: 'pop', pick: 'pop', throw: 'dig', special: 'crack', ready: 'pop' };

/** Your weapon and the special it gives. */
function myWeapon() {
  const g = gearByKey(useGame.getState().save.pickaxe);
  const item = g ? { key: g.key, name: g.name } : { key: 'pick-wood', name: 'Kayu Pick' };
  const sp = specialOf(item);
  return { item, sp, info: SPECIAL_INFO[sp] };
}
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
  const [stage, setStage] = useState<'menu' | 'search' | 'fight' | 'done'>('menu');
  const [tab, setTab] = useState<'online' | 'bots'>('online');
  const [mode, setMode] = useState<Mode>('1v1');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<BrawlResult | null>(null);
  const [soloNote, setSoloNote] = useState(false);
  const lastQ = useRef<Queue>('1v1');
  const phase = useOnline((s) => s.phase);
  const omatch = useOnline((s) => s.match);
  const solo = useOnline((s) => s.solo);
  const touch = !L.desktop || LANDSCAPE_APP;
  // a phone held sideways is short: a smaller menu that scrolls
  const short = L.h < 480;

  useEffect(() => {
    if (open && !atlas) atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
    if (!open) {
      setStage('menu');
      leaveOnline();
    }
  }, [open, atlas]);

  // match messages from the room go straight to the canvas
  useEffect(() => {
    onNet((e, p) => ref.current?.feed(e, p));
    return () => onNet(null);
  }, []);

  // found: start the online match
  useEffect(() => {
    if (phase !== 'match' || !omatch || stage !== 'search') return;
    const me = useOnline.getState().me;
    setResult(null);
    setSoloNote(false);
    setStage('fight');
    ref.current?.begin({ mode: omatch.mode, diff: 'normal', name: name || 'You', look: myLook(), weapon: 'pick', special: myWeapon().sp, seed: omatch.seed, net: { role: omatch.host === me ? 'host' : 'guest', me, mid: omatch.mid, host: omatch.host, players: omatch.players } });
  }, [phase, omatch, stage, name]);

  // nobody came: bots instead
  useEffect(() => {
    if (!solo || stage !== 'search') return;
    useOnline.setState({ solo: false });
    setSoloNote(true);
    setResult(null);
    setStage('fight');
    ref.current?.begin({ mode: lastQ.current === 'ffa' ? 'ffa' : '1v1', diff: 'normal', name: name || 'You', look: myLook(), weapon: 'pick', special: myWeapon().sp });
  }, [solo, stage, name]);

  const fight = () => {
    setResult(null);
    setSoloNote(false);
    setStage('fight');
    ref.current?.begin({ mode, diff, name: name || 'You', look: myLook(), weapon: 'pick', special: myWeapon().sp });
  };
  const find = (q: Queue) => {
    lastQ.current = q;
    setResult(null);
    setStage('search');
    search(q, { name: name || 'Miner', look: myLook(), weapon: 'pick', sp: myWeapon().sp }, useGame.getState().wallet.owner);
  };
  const onEvent = (e: BrawlEvent) => {
    if (e.t === 'sfx') play(SFX[e.name] ?? 'pop');
    else if (e.t === 'net') sendNet(e.e, e.p);
    else if (e.t === 'end') {
      if (e.result.online) endMatch(false);
      setResult(e.result);
      setStage('done');
    } else if (e.t === 'menu') {
      // Escape with the mining drawer out closes the drawer, not the match
      if (useMinePanel.getState().open) return;
      ref.current?.quit();
      if (useOnline.getState().phase === 'match') endMatch(true);
      setStage('menu');
    }
  };
  if (!open) return null;
  const exit = () => {
    ref.current?.quit();
    leaveOnline();
    useArena.getState().close();
  };
  const again = () => (result?.online || soloNote ? find(lastQ.current) : fight());
  const wpn = myWeapon();

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
            <PixelBox fill="rgba(20,12,14,0.95)" hi={COLORS.gold} lo="#04060f" shadow={1} style={[styles.card, short && { gap: 6, padding: 10 }]}>
              <View style={styles.head}>
                <T v="label" style={{ color: COLORS.teal, letterSpacing: 3, fontSize: short ? 9 : 11 }}>
                  UNDER THE MINE
                </T>
                <T v="display" style={[styles.logo, short && { fontSize: 24, lineHeight: 26 }]}>
                  GALI FIGHTCLUB
                </T>
                {short ? null : (
                  <T v="muted" style={{ textAlign: 'center', fontSize: 12 }}>
                    Knock miners out of the ring. Every hit raises their %, and the higher it gets, the further they fly. 3 lives each.
                  </T>
                )}
              </View>
              <SpecialCard name={wpn.info.name} line={wpn.info.line} item={wpn.item.name} color={wpn.info.color} keyHint={touch ? 'SP button' : 'I or E'} short={short} />
              <View style={styles.tabs}>
                <Tab label="FIGHT ONLINE" on={tab === 'online'} onPress={() => setTab('online')} />
                <Tab label="PRACTICE VS BOTS" on={tab === 'bots'} onPress={() => setTab('bots')} />
              </View>
              <T v="label" style={styles.lbl}>
                MATCH
              </T>
              <View style={styles.row}>
                <Choice label="1 V 1" sub={tab === 'online' ? 'You and one miner' : 'You and one bot'} on={mode === '1v1'} onPress={() => setMode('1v1')} />
                <Choice label="FREE FOR ALL" sub={tab === 'online' ? 'Up to 4, bots fill in' : 'You and 3 bots'} on={mode === 'ffa'} onPress={() => setMode('ffa')} />
              </View>
              {tab === 'bots' ? (
                <>
                  <T v="label" style={styles.lbl}>
                    BOTS
                  </T>
                  <View style={styles.row}>
                    {DIFF.map(([d, l, s]) => (
                      <Choice key={d} label={l} sub={s} on={diff === d} onPress={() => setDiff(d)} />
                    ))}
                  </View>
                  <Btn kind="gold" label="FIGHT" onPress={fight} />
                </>
              ) : (
                <>
                  <Btn kind="gold" label="FIND A MATCH" onPress={() => find(mode)} />
                  <T v="label" style={styles.lbl}>
                    PRIVATE ROOM
                  </T>
                  <View style={[styles.row, { alignItems: 'center' }]}>
                    <Btn kind="plain" label="NEW ROOM" onPress={() => find(`code:${newCode()}`)} style={{ flex: 1 }} />
                    <TextInput
                      value={code}
                      onChangeText={(t) => setCode(cleanCode(t))}
                      placeholder="CODE"
                      placeholderTextColor={COLORS.muted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      maxLength={4}
                      style={styles.code}
                    />
                    <Btn kind="plain" label="JOIN" disabled={code.length !== 4} onPress={() => find(`code:${code}`)} />
                  </View>
                </>
              )}
              <T v="muted" style={{ fontSize: 11, textAlign: 'center' }}>
                {touch
                  ? 'Left thumb: move. Right: JUMP, LIGHT, HEAVY, DODGE, SP. Hold down + a button to aim down. HEAVY in the air without down flies you up.'
                  : 'A/D move · W or Space jump · S down · J light · K heavy · L or Shift dodge · I or E special. Heavy in the air flies you up; down + heavy slams.'}
              </T>
            </PixelBox>
          </ScrollView>
        ) : null}
        {/* mine while you fight: the round chip and the DEPLOY drawer, hideable like everywhere else */}
        <MineAnywhere at="arena" />
        {stage === 'search' ? <Searching q={lastQ.current} onCancel={() => { cancel(); setStage('menu'); }} /> : null}
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
                    {r.you ? (r.name === 'You' ? 'You' : `${r.name} (you)`) : r.name}
                  </T>
                  <T v="muted">
                    {r.kos} KO · {r.falls} falls
                  </T>
                </View>
              ))}
              {result.note ? (
                <T v="muted" style={{ textAlign: 'center' }}>
                  {result.note}
                </T>
              ) : null}
              <View style={styles.row}>
                <Btn kind="gold" label={result.online || soloNote ? 'PLAY AGAIN' : 'REMATCH'} onPress={again} style={{ flex: 1 }} />
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
  card: { width: 500, maxWidth: '100%', padding: 16, gap: 10 },
  logo: { fontSize: 32, lineHeight: 34, color: COLORS.gold, textAlign: 'center', letterSpacing: 2 },
  lbl: { color: COLORS.teal, marginTop: 2 },
  row: { flexDirection: 'row', gap: 8 },
  res: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 6 },
  head: { alignItems: 'center', gap: 2 },
  tabs: { flexDirection: 'row', borderWidth: 2, borderColor: '#3a2414', backgroundColor: '#140a08' },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  sp: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.03)' },
  spBadge: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 2, transform: [{ rotate: '45deg' }] },
  code: { width: 86, minHeight: 40, borderWidth: 2, borderColor: '#2d4282', backgroundColor: '#0b1430', color: COLORS.text, textAlign: 'center', fontSize: 18, letterSpacing: 4, paddingHorizontal: 6 },
});

/** Looking for other miners: who is in, and what happens next. */
function Searching({ q, onCancel }: { q: Queue; onCancel: () => void }) {
  const phase = useOnline((s) => s.phase);
  const me = useOnline((s) => s.me);
  const since = useOnline((s) => s.since);
  const error = useOnline((s) => s.error);
  useOnline((s) => s.peers);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const room = q.startsWith('code:') ? q.slice(5) : null;
  const list = queueList();
  const host = list[0]?.id === me;
  const waited = Date.now() - since;
  const left = (ms: number) => Math.max(0, Math.ceil((ms - waited) / 1000));
  let line: string;
  if (error) line = error;
  else if (phase === 'connecting') line = 'Connecting to the arena...';
  else if (room) line = host ? (list.length < 2 ? 'Share the code. You start when someone joins.' : 'Start when everyone is in (up to 4).') : 'Waiting for the room host to start.';
  else if (list.length < 2) line = `Nobody yet. Bots step in after ${left(SOLO_WAIT_MS)}s.`;
  else if (q === 'ffa') line = list.length >= 4 ? 'Starting...' : `Starting in ${left(FFA_WAIT_MS)}s. Bots fill the empty spots.`;
  else line = 'Found one. Starting...';
  return (
    <View style={styles.centerAbs} pointerEvents="box-none">
      <PixelBox fill="rgba(12,8,24,0.95)" hi={COLORS.gold} lo="#04060f" shadow={1} style={styles.card}>
        <T v="display" style={[styles.logo, { fontSize: 24, lineHeight: 26 }]}>
          {room ? `ROOM ${room}` : q === 'ffa' ? 'FREE FOR ALL' : '1 V 1'}
        </T>
        <T style={{ textAlign: 'center' }}>{line}</T>
        {list.map((p) => (
          <View key={p.id} style={styles.res}>
            <T v="bold" style={{ flex: 1 }}>
              {p.id === me ? `${p.name} (you)` : p.name}
            </T>
            {p.id === list[0].id ? <T v="muted">HOST</T> : null}
          </View>
        ))}
        <View style={styles.row}>
          {room && host ? <Btn kind="gold" label="START" disabled={list.length < 2} onPress={startRoom} style={{ flex: 1 }} /> : null}
          <Btn kind="plain" label="CANCEL" onPress={onCancel} style={{ flex: 1 }} />
        </View>
      </PixelBox>
    </View>
  );
}

/** A tab in the menu's top switch. */
function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} style={[styles.tab, on && { backgroundColor: COLORS.gold }]}>
      <T v="bold" style={{ fontSize: 12, color: on ? '#1a0e08' : COLORS.muted, letterSpacing: 1 }}>
        {label}
      </T>
    </Pressable>
  );
}

/** Your special move: what your weapon brings to the fight. */
function SpecialCard({ name, line, item, color, keyHint, short }: { name: string; line: string; item: string; color: string; keyHint: string; short: boolean }) {
  return (
    <View style={[styles.sp, { borderColor: color }]}>
      <View style={[styles.spBadge, { borderColor: color, backgroundColor: color + '22' }]}>
        <T v="display" style={{ color, fontSize: 16, transform: [{ rotate: '-45deg' }] }}>
          SP
        </T>
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <T v="label" style={{ color: COLORS.muted, fontSize: 9 }}>
          YOUR SPECIAL · FROM {item.toUpperCase()}
        </T>
        <T v="display" style={{ color, fontSize: 16, lineHeight: 18 }}>
          {name}
        </T>
        {short ? null : (
          <T v="muted" style={{ fontSize: 11 }}>
            {line} Fill the meter by landing and taking hits, then press {keyHint}.
          </T>
        )}
      </View>
    </View>
  );
}
