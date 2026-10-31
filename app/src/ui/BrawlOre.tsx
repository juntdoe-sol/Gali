/**
 * BrawlOre: the new Brawl Arena (plan: project doc claude/gali-brawl-arena-v2.md). A simple platform fighter:
 * knock miners off the stage, 3 lives each. 1v1 or a 4-miner free-for-all, online with other miners
 * (game/brawl2/online.ts) or against bots.
 *
 * The fight runs in the canvas (pixel/BrawlOreView, engine/brawlore.ts); this screen is the menu around it and
 * the results. It opens where the old arena opened (useArena.open) while the `?brawlore=1` test flag is on.
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useArena } from '../game/arena';
import { play, type Sound } from '../game/sfx';
import { useName } from '../game/username';
import { useGame } from '../game/store';
import { cancel, endMatch, FFA_WAIT_MS, leaveOnline, onNet, queueList, search, sendNet, SOLO_WAIT_MS, startRoom, useOnline, type Queue } from '../game/brawl2/online';
import { cleanCode, newCode } from '../game/brawl2/net';
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
    ref.current?.begin({ mode: omatch.mode, diff: 'normal', name: name || 'You', look: myLook(), weapon: 'pick', seed: omatch.seed, net: { role: omatch.host === me ? 'host' : 'guest', me, mid: omatch.mid, host: omatch.host, players: omatch.players } });
  }, [phase, omatch, stage, name]);

  // nobody came: bots instead
  useEffect(() => {
    if (!solo || stage !== 'search') return;
    useOnline.setState({ solo: false });
    setSoloNote(true);
    setResult(null);
    setStage('fight');
    ref.current?.begin({ mode: lastQ.current === 'ffa' ? 'ffa' : '1v1', diff: 'normal', name: name || 'You', look: myLook(), weapon: 'pick' });
  }, [solo, stage, name]);

  const fight = () => {
    setResult(null);
    setSoloNote(false);
    setStage('fight');
    ref.current?.begin({ mode, diff, name: name || 'You', look: myLook(), weapon: 'pick' });
  };
  const find = (q: Queue) => {
    lastQ.current = q;
    setResult(null);
    setStage('search');
    search(q, { name: name || 'Miner', look: myLook(), weapon: 'pick' }, useGame.getState().wallet.owner);
  };
  const onEvent = (e: BrawlEvent) => {
    if (e.t === 'sfx') play(SFX[e.name] ?? 'pop');
    else if (e.t === 'net') sendNet(e.e, e.p);
    else if (e.t === 'end') {
      if (e.result.online) endMatch(false);
      setResult(e.result);
      setStage('done');
    } else if (e.t === 'menu') {
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
              <View style={styles.row}>
                <Choice label="ONLINE" sub="Fight other miners" on={tab === 'online'} onPress={() => setTab('online')} />
                <Choice label="VS BOTS" sub="Practice" on={tab === 'bots'} onPress={() => setTab('bots')} />
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
                  ? 'Left thumb: move. Right: JUMP, LIGHT, HEAVY, DODGE. Hold down + a button to aim down. HEAVY in the air without down flies you up.'
                  : 'A/D move · W or Space jump · S down · J or left click light · K or right click heavy · L or Shift dodge. Heavy in the air flies you up; down + heavy slams.'}
              </T>
            </PixelBox>
          </ScrollView>
        ) : null}
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
  card: { width: 460, maxWidth: '100%', padding: 16, gap: 10 },
  logo: { fontSize: 36, lineHeight: 38, color: COLORS.gold, textAlign: 'center', letterSpacing: 2 },
  lbl: { color: COLORS.teal, marginTop: 2 },
  row: { flexDirection: 'row', gap: 8 },
  res: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, paddingHorizontal: 6 },
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
