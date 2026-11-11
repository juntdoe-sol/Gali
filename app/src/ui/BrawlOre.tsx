/**
 * Gali Fightclub: the new Brawl Arena (plan: project doc claude/gali-brawl-arena-v2.md). A simple platform fighter
 * in a fight pit under the mine: knock miners off the ring, 3 lives each. 1v1 or a 4-miner free-for-all, online
 * with other miners (game/brawl2/online.ts) or against bots. Each weapon brings a special move
 * (game/brawl2/specials.ts), used when the meter is full.
 *
 * The fight runs in the canvas (pixel/BrawlOreView, engine/brawlore.ts); this screen is the menu around it and
 * the results. It opens where the old arena opened (useArena.open).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, gearByKey } from '../game/constants';
import { useArena } from '../game/arena';
import { play, type Sound } from '../game/sfx';
import { useName } from '../game/username';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { cancel, endMatch, FFA_WAIT_MS, leaveOnline, onNet, queueList, search, sendNet, SOLO_WAIT_MS, startRoom, useOnline, type Queue } from '../game/brawl2/online';
import { cleanCode, newCode } from '../game/brawl2/net';
import { SPECIAL_INFO, specialOf } from '../game/brawl2/specials';
import { reportFight, tierOf, useFcRank } from '../game/brawl2/rank';
import { checkLater, fightLink, findRivals, fmtWhen, sendCallout, useCallout, xPostText, type Fight, type Rival } from '../game/brawl2/callout';
import { awardFightXp } from '../game/brawl';
import { useFightStats } from '../game/fightGear';
import type { BrawlEvent, BrawlResult } from '../engine/brawlore';
import type { Difficulty, Mode } from '../game/brawl2/sim';
import { atlasSource } from '../pixel/atlasSource';
import BrawlOreView, { type BrawlOreRef } from '../pixel/BrawlOreView';
import { myLook } from '../pixel/PixelMine';
import { Btn, Choice, INPUT, T } from './kit';
import { MineAnywhere, useMinePanel } from './MineAnywhere';
import { LANDSCAPE_APP, useLayout } from './layout';

/**
 * Gali Fightclub is the arena now, on the web and in the app. The old arena (Last Miner Standing, King of the
 * Ring, raids) stays in the code for a week as a fallback: `?oldarena=1` on the web opens it instead.
 */
export const BRAWLORE = !(Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]oldarena=1\b/.test(window.location?.search ?? ''));

const SFX: Record<string, Sound> = { swing: 'dig', hit: 'bonk', slam: 'crack', ko: 'ko', cheer: 'win', pop: 'pop', pick: 'pop', throw: 'dig', special: 'crack', ready: 'pop' };

/* ---------------- the street look: dark brick panels, a neon edge, caution tape on the corners ---------------- */

const PINK = '#ff3fa4';
const TAPE = '#ffc93c';
const GALI_PIXEL = require('../../assets/brand/logo.png');

/** Caution tape stuck across a corner. */
function Tape({ side }: { side: 'l' | 'r' }) {
  return (
    <View pointerEvents="none" style={[styles.tape, side === 'l' ? { left: -14, transform: [{ rotate: '-24deg' }] } : { right: -14, transform: [{ rotate: '24deg' }] }]}>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <View key={k} style={[styles.tapeStripe, { left: 6 + k * 14 }]} />
      ))}
    </View>
  );
}

/** A Fightclub panel: dark brick, black edge, a neon pink (or gold, for a win) line, tape on the top corners. */
function StreetCard({ children, style, tone = 'pink', tape = 'both' }: { children: React.ReactNode; style?: object | object[]; tone?: 'pink' | 'gold'; tape?: 'l' | 'r' | 'both' | 'none' }) {
  const hi = tone === 'gold' ? COLORS.gold : PINK;
  return (
    <View style={[styles.street, { borderColor: hi }, Platform.OS === 'web' ? ({ boxShadow: `0 0 0 3px #000, 0 0 22px ${hi}66` } as object) : null, style]}>
      {/* mortar lines, so the panel reads as brick */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: 14 }, (_, k) => (
          <View key={k} style={[styles.mortar, { top: `${(k + 1) * 7}%` as unknown as number }]} />
        ))}
      </View>
      {tape === 'l' || tape === 'both' ? <Tape side="l" /> : null}
      {tape === 'r' || tape === 'both' ? <Tape side="r" /> : null}
      {children}
    </View>
  );
}

/** A neon tube word: pale core, coloured glow. */
function Neon({ children, size = 32, color = PINK }: { children: React.ReactNode; size?: number; color?: string }) {
  return (
    <T v="display" style={{ fontSize: size, lineHeight: size * 1.05, textAlign: 'center', letterSpacing: 2, color: color === PINK ? '#ffd6ee' : '#d8fff8', textShadowColor: color, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } }}>
      {children}
    </T>
  );
}

/** Your weapon and the special it gives. */
function myWeapon() {
  const g = gearByKey(useGame.getState().save.pickaxe);
  const item = g ? { key: g.key, name: g.name } : { key: 'pick-wood', name: 'Kayu Pick' };
  const sp = specialOf(item);
  return { item, sp, info: SPECIAL_INFO[sp] };
}
const ORD = ['', '1ST', '2ND', '3RD', '4TH'];

/**
 * XP for a match, under the daily fight XP cap (game/brawl.ts DAY_CAP). Online against miners pays more than
 * practice against bots.
 */
function matchXp(r: BrawlResult) {
  if (r.online) return (r.place === 1 ? 40 : r.place === 2 && r.of > 2 ? 20 : 10) + r.kos * 5;
  return (r.place === 1 ? 12 : 4) + r.kos * 2;
}
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
  const [stage, setStage] = useState<'menu' | 'search' | 'fight' | 'done' | 'called'>('menu');
  const [tab, setTab] = useState<'online' | 'bots'>('online');
  const [mode, setMode] = useState<Mode>('1v1');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<BrawlResult | null>(null);
  const [soloNote, setSoloNote] = useState(false);
  const [xpGot, setXpGot] = useState(0);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const owner = useGame((s) => s.wallet.owner);
  const rank = useFcRank((s) => s.me);
  const last = useFcRank((s) => s.last);
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
  useEffect(() => {
    if (open) void useFcRank.getState().loadMe(owner);
  }, [open, owner]);

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
  const find = (q: Queue, need = 0, made = false) => {
    lastQ.current = q;
    setResult(null);
    setStage('search');
    search(q, { name: name || 'Miner', look: myLook(), weapon: 'pick', sp: myWeapon().sp }, useGame.getState().wallet.owner, { need, made });
  };
  // call out: tell the rivals, make the card; fight now (wait in the room) or later (a reminder at the time)
  const callOut = (rivals: Rival[], n: number, at: number) => {
    const fight: Fight = { code: newCode(), at, n, from: name || 'Miner', rivals: rivals.map((r) => (r.x ? '@' + r.x : r.name)), mine: true };
    setCardUrl(null);
    const later = at - Date.now() > 60_000;
    if (later) setStage('called');
    else find(`code:${fight.code}`, n);
    void sendCallout(fight, rivals).then((r) => {
      if (r.of) useGame.getState().toast(r.reached ? `${r.reached} of ${r.of} got your callout` : 'They are offline with no wallet to message. Share the card.', r.reached ? 'good' : 'info');
    });
    const peer = (nm: string) => Object.values(useLobby.getState().peers).find((p) => p.name === nm)?.look ?? null;
    const first = rivals[0];
    setTimeout(
      () =>
        ref.current?.card({
          me: { name: name || 'Miner', look: myLook(), special: myWeapon().sp },
          rival: { name: rivals.length > 1 ? `${rivals.length} MINERS` : first.x ? `@${first.x}` : first.name, look: rivals.length > 1 ? null : peer(first.name) },
          code: fight.code,
          link: fightLink(fight),
          when: later ? fmtWhen(at) : null,
        }),
      50,
    );
  };
  // a room to walk into: from a callout popup or a ?fight= link
  const join = useCallout((s) => s.join);
  useEffect(() => {
    if (!open || !join || stage === 'fight') return;
    useCallout.setState({ join: null });
    find(`code:${join.code}`, join.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, join]);
  const onEvent = (e: BrawlEvent) => {
    if (e.t === 'sfx') play(SFX[e.name] ?? 'pop');
    else if (e.t === 'card') setCardUrl(e.url);
    else if (e.t === 'net') sendNet(e.e, e.p);
    else if (e.t === 'end') {
      const r = e.result;
      const om = useOnline.getState().match;
      if (r.online) endMatch(false);
      setXpGot(r.place > 0 ? awardFightXp(matchXp(r)) : 0);
      // daily quests, achievements, fight titles and trails count Fightclub matches like the old arena's
      const g = useGame.getState();
      const fs = useFightStats.getState();
      g.track('arena');
      for (let k = 0; k < Math.min(r.kos, 10); k++) g.track('ko');
      if (r.kos) fs.add('kos', r.kos);
      if (r.falls) fs.add('downs', r.falls);
      if (r.place === 1 && r.of >= 2) {
        fs.add('wins');
        g.track('win');
      }
      // online, with every miner signed in: report the order so the server can rank it
      useFcRank.setState({ last: null });
      if (r.online && om && owner && r.mid === om.mid) {
        // miners who left mid-match were handed to a bot: they can't report, so the match isn't rated
        const humans = r.table.filter((t) => !t.bot);
        const left = om.players.some((p) => r.table.find((t) => t.id === p.id)?.bot);
        const ws = humans.map((t) => om.players.find((p) => p.id === t.id)?.w);
        if (!left && ws.length >= 2 && ws.every(Boolean) && ws.includes(owner)) void reportFight({ mid: om.mid, mode: om.mode, ord: ws as string[], me: owner });
        else useFcRank.setState({ last: { mid: om.mid, state: 'unrated', why: left ? 'a miner left the match' : 'every miner needs a wallet signed in' } });
      }
      setResult(r);
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
        {stage === 'menu' && !calling ? (
          <ScrollView style={styles.scroll} contentContainerStyle={[styles.center, { paddingVertical: short ? 6 : 12 }]}>
            <StreetCard style={[styles.card, short && { gap: 6, padding: 10 }]}>
              <View style={styles.head}>
                <T v="label" style={{ color: COLORS.teal, letterSpacing: 3, fontSize: short ? 9 : 11 }}>
                  BACK OF THE WAREHOUSE · NO REFS
                </T>
                <View style={styles.brandRow}>
                  <Image source={GALI_PIXEL} style={[styles.galiMark, short && { width: 30, height: 29 }]} resizeMode="contain" accessibilityLabel="Gali" />
                  <View>
                    <Neon size={short ? 15 : 20} color={COLORS.teal}>
                      GALI
                    </Neon>
                    <Neon size={short ? 26 : 38}>FIGHTCLUB</Neon>
                  </View>
                  <Image source={GALI_PIXEL} style={[styles.galiMark, short && { width: 30, height: 29 }, { transform: [{ scaleX: -1 }] }]} resizeMode="contain" />
                </View>
                <RankChip rating={rank?.rating ?? null} games={rank?.games ?? 0} place={rank?.place ?? null} signedIn={Boolean(owner)} />
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
                  <Btn kind="red" label="CALL OUT A MINER" sub="Challenge a Gali miner or a friend on X" onPress={() => setCalling(true)} />
                  <T v="label" style={styles.lbl}>
                    PRIVATE ROOM
                  </T>
                  <View style={[styles.row, { alignItems: 'center' }]}>
                    <Btn kind="plain" label="NEW ROOM" onPress={() => find(`code:${newCode()}`, 0, true)} style={{ flex: 1 }} />
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
            </StreetCard>
          </ScrollView>
        ) : null}
        {/* mine while you fight: the round chip and the DEPLOY drawer, hideable like everywhere else */}
        <MineAnywhere at="arena" />
        {stage === 'fight' ? null : <CalloutPopup inside />}
        {stage === 'search' ? (
          <Searching
            q={lastQ.current}
            card={cardUrl}
            onCancel={() => {
              cancel();
              useCallout.setState({ mine: null });
              setStage('menu');
            }}
          />
        ) : null}
        {calling && stage === 'menu' ? (
          <CallOutPanel
            onClose={() => setCalling(false)}
            onPick={(r, n, at) => {
              setCalling(false);
              callOut(r, n, at);
            }}
          />
        ) : null}
        {stage === 'called' ? <Called card={cardUrl} onDone={() => setStage('menu')} /> : null}
        {stage === 'done' && result ? (
          <View style={styles.centerAbs} pointerEvents="box-none">
            <StreetCard tone={result.place === 1 ? 'gold' : 'pink'} style={styles.card}>
              {result.place === 1 ? (
                <View style={styles.stamp} pointerEvents="none">
                  <T v="display" style={{ color: '#ff3040', fontSize: 24, lineHeight: 26 }}>
                    K.O.
                  </T>
                </View>
              ) : null}
              <Image source={GALI_PIXEL} style={[styles.galiMark, { alignSelf: 'center' }]} resizeMode="contain" accessibilityLabel="Gali" />
              <T v="display" style={[styles.big, { color: result.place === 1 ? COLORS.gold : COLORS.text }]}>
                {result.place === 1 ? 'YOU WIN!' : `${ORD[result.place] ?? result.place} PLACE`}
              </T>
              {result.table.map((r) => (
                <View key={r.name + r.place} style={[styles.res, styles.paper, r.you && { backgroundColor: COLORS.gold }, { transform: [{ rotate: r.place % 2 ? '-0.6deg' : '0.5deg' }] }]}>
                  <T v="display" style={{ width: 44, color: '#c0202e', fontSize: 18 }}>
                    {ORD[r.place] ?? r.place}
                  </T>
                  <T v="bold" style={{ flex: 1, color: '#140c10' }}>
                    {r.you ? (r.name === 'You' ? 'You' : `${r.name} (you)`) : r.name}
                  </T>
                  <T style={{ color: '#3a2a30', fontSize: 12 }}>
                    {r.kos} KO · {r.falls} falls
                  </T>
                </View>
              ))}
              {result.note ? (
                <T v="muted" style={{ textAlign: 'center' }}>
                  {result.note}
                </T>
              ) : null}
              <View style={[styles.row, { justifyContent: 'center', flexWrap: 'wrap' }]}>
                <T v="bold" style={{ color: COLORS.teal }}>{xpGot > 0 ? `+${xpGot} XP` : 'Daily fight XP reached'}</T>
                {result.online ? (
                  <T v="bold" style={{ color: last?.state === 'done' ? ((last.delta ?? 0) >= 0 ? COLORS.green : COLORS.red) : COLORS.muted }}>
                    {' · '}
                    {!last
                      ? 'Sign in to be ranked'
                      : last.state === 'waiting'
                        ? 'Rank: waiting for every miner’s result…'
                        : last.state === 'done'
                          ? `RANK ${(last.delta ?? 0) >= 0 ? '+' : ''}${last.delta} · ${last.rating} ${tierOf(last.rating ?? 1000).tier}`
                          : `Not ranked: ${last.why}`}
                  </T>
                ) : (
                  <T v="muted">{' · '}Practice: online matches move your rank</T>
                )}
              </View>
              <View style={styles.row}>
                <Btn kind="gold" label={result.online || soloNote ? 'PLAY AGAIN' : 'REMATCH'} onPress={again} style={{ flex: 1 }} />
                <Btn kind="plain" label="MENU" onPress={() => setStage('menu')} style={{ flex: 1 }} />
              </View>
            </StreetCard>
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
  // position: relative, or the panel's fill (positioned) paints over the text field on the web
  input: { ...INPUT, position: 'relative', zIndex: 1, color: '#ffffff', backgroundColor: '#0c0610', borderTopColor: '#000000', borderLeftColor: '#000000', borderBottomColor: '#ff5a6a', borderRightColor: '#ff5a6a' },
  rival: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: 'rgba(255,255,255,0.04)' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  popWrap: { position: 'absolute', top: 70, left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  popCard: { width: 380, maxWidth: '94%', padding: 12, gap: 6 },
  when: { borderWidth: 1, borderColor: '#5a3040', paddingHorizontal: 8, paddingVertical: 7 },
  whenOn: { backgroundColor: '#ff5a6a', borderColor: '#ff5a6a' },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#5a3040', backgroundColor: '#0c0610' },
  stepBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  street: { borderWidth: 2, backgroundColor: '#160e12', overflow: 'visible' },
  mortar: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  tape: { position: 'absolute', top: -8, width: 84, height: 18, backgroundColor: TAPE, overflow: 'hidden', zIndex: 3 },
  tapeStripe: { position: 'absolute', top: -6, width: 6, height: 30, backgroundColor: 'rgba(20,12,16,0.85)', transform: [{ rotate: '35deg' }] },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginVertical: 2 },
  galiMark: { width: 44, height: 42 },
  big: { fontSize: 44, lineHeight: 44, textAlign: 'center', letterSpacing: 2, textShadowColor: '#000', textShadowRadius: 0, textShadowOffset: { width: 3, height: 3 } },
  stamp: { position: 'absolute', right: 16, top: 14, borderWidth: 3, borderColor: '#ff3040', paddingHorizontal: 6, transform: [{ rotate: '14deg' }], opacity: 0.85, zIndex: 4 },
  paper: { backgroundColor: '#efe4c6' },
  plate: { backgroundColor: '#6a6e7a', borderColor: '#000', borderWidth: 2 },
  tabOn: { backgroundColor: TAPE },
  flyer: { backgroundColor: '#f4eadb', borderWidth: 3, borderColor: '#000', transform: [{ rotate: '-1.2deg' }] },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, marginVertical: 2 },
  rankGem: { width: 8, height: 8, transform: [{ rotate: '45deg' }] },
  tabs: { flexDirection: 'row', borderWidth: 2, borderColor: '#3a2414', backgroundColor: '#140a08' },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  sp: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 2, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.03)' },
  spBadge: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 2, transform: [{ rotate: '45deg' }] },
  code: { position: 'relative', zIndex: 1, width: 86, minHeight: 40, borderWidth: 2, borderColor: '#2d4282', backgroundColor: '#0b1430', color: COLORS.text, textAlign: 'center', fontSize: 18, letterSpacing: 4, paddingHorizontal: 6 },
});

/** Looking for other miners: who is in, and what happens next. */
function Searching({ q, onCancel, card }: { q: Queue; onCancel: () => void; card: string | null }) {
  const mine = useCallout((s) => s.mine);
  const phase = useOnline((s) => s.phase);
  const me = useOnline((s) => s.me);
  const made = useOnline((s) => s.made);
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
  else if (room && mine && mine.fight.code === room) line = list.length < mine.fight.n ? `Waiting for ${mine.fight.rivals.join(', ')}. The fight starts when ${mine.fight.n > 2 ? 'everyone is' : 'they are'} in.` : 'Everyone is here. Starting...';
  else if (room && !made && list.length < 2)
    // joined with a code and nobody showed up: the room's maker has the game in the background, or left
    line = 'Nobody here yet. The room only shows players with the Fightclub open: ask your friend to come back to it (switching apps pauses it).';
  else if (room) {
    const here = list.filter((p) => !p.away).length;
    line = host
      ? here < 2
        ? 'Share the code, then come back here. You start when someone joins.'
        : 'Start when everyone is in (up to 4).'
      : list[0]?.away
        ? 'The host stepped away (sharing the code?). They start when they are back.'
        : 'Waiting for the room host to start.';
  }
  else if (list.length < 2) line = `Nobody yet. Bots step in after ${left(SOLO_WAIT_MS)}s.`;
  else if (q === 'ffa') line = list.length >= 4 ? 'Starting...' : `Starting in ${left(FFA_WAIT_MS)}s. Bots fill the empty spots.`;
  else line = 'Found one. Starting...';
  return (
    <View style={styles.centerAbs} pointerEvents="box-none">
      <StreetCard tape="l" style={styles.card}>
        <T v="label" style={{ color: COLORS.teal, letterSpacing: 3, fontSize: 11, textAlign: 'center' }}>
          LOOKING FOR A FIGHT
        </T>
        <Neon size={28}>{room ? `ROOM ${room}` : q === 'ffa' ? 'FREE FOR ALL' : '1 V 1'}</Neon>
        <T style={{ textAlign: 'center' }}>{line}</T>
        {list.map((p) => (
          <View key={p.id} style={styles.res}>
            <T v="bold" style={{ flex: 1 }}>
              {p.id === me ? `${p.name} (you)` : p.away ? `${p.name} (away, back soon?)` : p.name}
            </T>
            {p.id === list[0].id && (list.length > 1 || made) ? <T v="muted">HOST</T> : null}
          </View>
        ))}
        {mine && room === mine.fight.code ? <CardShare rivals={mine.rivals} fight={mine.fight} card={card} /> : null}
        <View style={styles.row}>
          {room && host && !(mine && mine.fight.code === room) ? <Btn kind="gold" label="START" disabled={list.filter((p) => !p.away).length < 2} onPress={startRoom} style={{ flex: 1 }} /> : null}
          <Btn kind="plain" label="CANCEL" onPress={onCancel} style={{ flex: 1 }} />
        </View>
      </StreetCard>
    </View>
  );
}

/** Your Fightclub rank in the menu: tier badge and rating (online matches move it). */
function RankChip({ rating, games, place, signedIn }: { rating: number | null; games: number; place: number | null; signedIn: boolean }) {
  if (!signedIn) {
    return (
      <T v="muted" style={{ fontSize: 11 }}>
        Connect your wallet to get a Fightclub rank.
      </T>
    );
  }
  const r = rating ?? 1000;
  const t = tierOf(r);
  return (
    <View style={[styles.rank, styles.plate]}>
      <View style={[styles.rankGem, { backgroundColor: t.color }]} />
      <View style={{ backgroundColor: '#140c10', paddingHorizontal: 5 }}>
        <T v="display" style={{ color: t.color, fontSize: 14 }}>
          {t.tier}
        </T>
      </View>
      <T v="bold" style={{ fontSize: 13, color: '#101014' }}>
        {r}
      </T>
      <T style={{ fontSize: 11, color: '#2a2a34' }}>
        {games ? `${games} rated${place ? ` · #${place}` : ''}` : 'unrated'}
      </T>
    </View>
  );
}

/** A tab in the menu's top switch. */
function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label} style={[styles.tab, on && styles.tabOn]}>
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

/** A time you set: the day (0 = today) and the clock, in your own time zone. */
interface When {
  now: boolean;
  day: number;
  hour: number;
  min: number;
}
const whenAt = (w: When) => {
  if (w.now) return Date.now();
  const d = new Date();
  d.setDate(d.getDate() + w.day);
  d.setHours(w.hour, w.min, 0, 0);
  return d.getTime();
};
/** the next quarter hour, at least 15 minutes away */
function nextSlot(): When {
  const d = new Date(Date.now() + 15 * 60_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86_400_000);
  return { now: false, day, hour: d.getHours(), min: d.getMinutes() };
}
const dayName = (k: number) => {
  if (k === 0) return 'TODAY';
  if (k === 1) return 'TOMORROW';
  const d = new Date();
  d.setDate(d.getDate() + k);
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
};

/** One value with arrows either side: the day, the hour, the minutes. */
function Stepper({ label, value, onStep, width = 70 }: { label: string; value: string; onStep: (d: number) => void; width?: number }) {
  return (
    <View style={{ alignItems: 'center', gap: 2 }}>
      <T v="tiny" style={{ fontSize: 8, color: COLORS.muted, letterSpacing: 1 }}>
        {label}
      </T>
      <View style={styles.stepper}>
        <Pressable onPress={() => onStep(-1)} style={styles.stepBtn} accessibilityLabel={`${label} back`}>
          <T v="display" style={{ fontSize: 16, color: '#ff5a6a' }}>
            ‹
          </T>
        </Pressable>
        <T v="display" style={{ fontSize: 15, color: COLORS.text, width, textAlign: 'center' }}>
          {value}
        </T>
        <Pressable onPress={() => onStep(1)} style={styles.stepBtn} accessibilityLabel={`${label} forward`}>
          <T v="display" style={{ fontSize: 16, color: '#ff5a6a' }}>
            ›
          </T>
        </Pressable>
      </View>
    </View>
  );
}

/** NOW, or a day and time you set yourself (up to 2 weeks ahead). */
function WhenPicker({ when, setWhen }: { when: When; setWhen: (w: When) => void }) {
  const at = whenAt(when);
  const past = !when.now && at < Date.now() + 60_000;
  const h12 = when.hour % 12 || 12;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <Pressable onPress={() => setWhen({ ...when, now: true })} style={[styles.when, { flex: 1, alignItems: 'center' }, when.now && styles.whenOn]}>
          <T v="bold" style={{ fontSize: 12, color: when.now ? '#1a0608' : COLORS.text }}>
            FIGHT NOW
          </T>
        </Pressable>
        <Pressable onPress={() => setWhen(when.now ? nextSlot() : when)} style={[styles.when, { flex: 1, alignItems: 'center' }, !when.now && styles.whenOn]}>
          <T v="bold" style={{ fontSize: 12, color: !when.now ? '#1a0608' : COLORS.text }}>
            SET A TIME
          </T>
        </Pressable>
      </View>
      {when.now ? null : (
        <View style={[styles.row, { justifyContent: 'center', flexWrap: 'wrap', gap: 10 }]}>
          <Stepper label="DAY" value={dayName(when.day)} width={110} onStep={(d) => setWhen({ ...when, day: Math.max(0, Math.min(13, when.day + d)) })} />
          <Stepper label="HOUR" value={String(h12)} width={30} onStep={(d) => setWhen({ ...when, hour: (when.hour + d + 24) % 24 })} />
          <Stepper label="MIN" value={String(when.min).padStart(2, '0')} width={30} onStep={(d) => setWhen({ ...when, min: (when.min + d * 5 + 60) % 60 })} />
          <Stepper label="AM / PM" value={when.hour < 12 ? 'AM' : 'PM'} width={30} onStep={() => setWhen({ ...when, hour: (when.hour + 12) % 24 })} />
        </View>
      )}
      <T v="muted" style={{ fontSize: 11, color: past ? '#ff5a6a' : COLORS.muted }}>
        {when.now ? 'You wait in the room and the fight starts when they walk in.' : past ? 'That time has passed. Pick a time in the future.' : `Fight at ${fmtWhen(at)}. No waiting: everyone gets a FIGHT popup at the time.`}
      </T>
    </View>
  );
}

/**
 * Who to call out, and when. 1v1: a Gali miner by name (online ones first) or a friend on X. Free for all: up to 3
 * online Gali miners with a wallet.
 */
function CallOutPanel({ onPick, onClose }: { onPick: (r: Rival[], n: number, at: number) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'gali' | 'x' | 'ffa'>('gali');
  const [q, setQ] = useState('');
  const [handle, setHandle] = useState('');
  const [list, setList] = useState<Rival[]>([]);
  const [picked, setPicked] = useState<Rival[]>([]);
  const [when, setWhen] = useState<When>({ now: true, day: 0, hour: 21, min: 0 });
  useEffect(() => {
    let on = true;
    const t = setTimeout(() => void findRivals(q, tab === 'ffa').then((r) => on && setList(r)), 250);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [q, tab]);
  const h = handle.replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 15);
  const at = whenAt(when);
  const bad = !when.now && at < Date.now() + 60_000;
  const toggle = (r: Rival) => setPicked((p) => (p.some((x) => x.wallet === r.wallet) ? p.filter((x) => x.wallet !== r.wallet) : p.length >= 3 ? p : [...p, r]));
  return (
    <View style={styles.centerAbs} pointerEvents="box-none">
      <ScrollView style={styles.scroll} contentContainerStyle={styles.center}>
        <StreetCard tape="r" style={styles.card}>
          <T v="display" style={[styles.logo, { fontSize: 24, lineHeight: 26, color: '#ff5a6a' }]}>
            CALL OUT
          </T>
          <View style={styles.tabs}>
            <Tab label="1V1 GALI" on={tab === 'gali'} onPress={() => setTab('gali')} />
            <Tab label="1V1 ON X" on={tab === 'x'} onPress={() => setTab('x')} />
            <Tab label="FREE FOR ALL" on={tab === 'ffa'} onPress={() => setTab('ffa')} />
          </View>
          <T v="label" style={styles.lbl}>
            WHEN
          </T>
          <WhenPicker when={when} setWhen={setWhen} />
          {tab === 'x' ? (
            <>
              <TextInput value={handle} onChangeText={setHandle} placeholder="@handle" placeholderTextColor={COLORS.muted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <Btn kind="red" label="CALL OUT ON X" disabled={h.length < 1 || bad} onPress={() => onPick([{ name: '@' + h, wallet: null, x: h }], 2, at)} />
              <T v="muted" style={{ fontSize: 11 }}>
                You get a card and a ready post. Your friend taps the link, picks a name, and lands in your room.
              </T>
            </>
          ) : (
            <>
              <TextInput value={q} onChangeText={setQ} placeholder={tab === 'ffa' ? 'Filter online miners' : 'Gali name'} placeholderTextColor={COLORS.muted} autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <View style={{ gap: 4 }}>
                {!list.length ? (
                  <T v="muted" style={{ fontSize: 12 }}>
                    {tab === 'ffa' ? 'No online miners with a wallet right now.' : q.length < 2 ? 'Miners online now show here. Type 2 letters to search every Gali miner.' : 'No miner by that name.'}
                  </T>
                ) : (
                  list.map((r) => {
                    const on = picked.some((x) => x.wallet === r.wallet);
                    return (
                      <Pressable key={(r.wallet ?? '') + r.name} onPress={() => (tab === 'ffa' ? toggle(r) : !bad && onPick([r], 2, at))} style={[styles.rival, on && { backgroundColor: 'rgba(255,90,106,0.18)' }]}>
                        <View style={[styles.dot, { backgroundColor: r.online ? COLORS.green : '#4a4060' }]} />
                        <T v="bold" style={{ flex: 1 }} numberOfLines={1}>
                          {r.name}
                        </T>
                        {r.level ? <T v="muted">Lv {r.level}</T> : null}
                        <T v="bold" style={{ color: '#ff5a6a' }}>
                          {tab === 'ffa' ? (on ? 'IN' : 'ADD') : 'CALL OUT'}
                        </T>
                      </Pressable>
                    );
                  })
                )}
              </View>
              {tab === 'ffa' ? (
                <Btn kind="red" label={`CALL OUT ${picked.length || ''} ${picked.length === 1 ? 'MINER' : 'MINERS'}`.replace('  ', ' ')} disabled={!picked.length || bad} onPress={() => onPick(picked, picked.length + 1, at)} />
              ) : null}
              <T v="muted" style={{ fontSize: 11 }}>
                {tab === 'ffa' ? 'Pick up to 3 online miners with a wallet. Bots fill a spot if someone does not show.' : 'Online miners get a popup at once. Miners with a wallet also get it as a message.'}
              </T>
            </>
          )}
          <Btn kind="plain" label="BACK" onPress={onClose} />
        </StreetCard>
      </ScrollView>
    </View>
  );
}

/** A callout set for later: the card to share, and a note that the game will call everyone at the time. */
function Called({ card, onDone }: { card: string | null; onDone: () => void }) {
  const mine = useCallout((s) => s.mine);
  if (!mine) return null;
  return (
    <View style={styles.centerAbs} pointerEvents="box-none">
      <StreetCard tape="r" style={styles.card}>
        <T v="display" style={[styles.logo, { fontSize: 22, lineHeight: 24, color: '#ff5a6a' }]}>
          CALLOUT SET
        </T>
        <T style={{ textAlign: 'center' }}>{`${mine.fight.rivals.join(', ')} · ${fmtWhen(mine.fight.at)} · room ${mine.fight.code}`}</T>
        <CardShare rivals={mine.rivals} fight={mine.fight} card={card} />
        <T v="muted" style={{ fontSize: 11, textAlign: 'center' }}>
          At the time, a FIGHT popup takes you in. Keep Gali open, or come back then.
        </T>
        <Btn kind="plain" label="DONE" onPress={onDone} />
      </StreetCard>
    </View>
  );
}

/** The callout card and how to share it. */
function CardShare({ rivals, fight, card }: { rivals: Rival[]; fight: Fight; card: string | null }) {
  const link = fightLink(fight);
  const code = fight.code;
  const post = () => void Linking.openURL(`https://x.com/intent/post?text=${encodeURIComponent(xPostText(rivals, fight))}&url=${encodeURIComponent(link)}`);
  const save = () => {
    if (!card || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const a = document.createElement('a');
    a.href = card;
    a.download = `gali-callout-${code}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  const copy = () => {
    try {
      void (globalThis as unknown as { navigator?: { clipboard?: { writeText: (s: string) => Promise<void> } } }).navigator?.clipboard?.writeText(link);
      useGame.getState().toast('Link copied', 'good');
    } catch {
      /* no clipboard */
    }
  };
  return (
    <View style={{ gap: 6 }}>
      {card ? <Image source={{ uri: card }} style={{ width: '100%', aspectRatio: 1200 / 630 }} resizeMode="contain" accessibilityLabel="Your callout card" /> : null}
      <View style={styles.row}>
        {Platform.OS === 'web' ? <Btn small kind="plain" label="SAVE CARD" disabled={!card} onPress={save} style={{ flex: 1 }} /> : null}
        <Btn small kind="gold" label="POST ON X" onPress={post} style={{ flex: 1.3 }} />
        {Platform.OS === 'web' ? <Btn small kind="plain" label="COPY LINK" onPress={copy} style={{ flex: 1 }} /> : null}
      </View>
      <T v="muted" style={{ fontSize: 11, textAlign: 'center' }}>
        {Platform.OS === 'web' ? 'Save the card, then attach it to your post on X.' : 'Screenshot the card to attach it to your post.'}
      </T>
    </View>
  );
}

/**
 * Someone called you out (or a ?fight= link opened the game): a popup anywhere in Gali, and FIGHT takes you into
 * their room. Lives outside the Fightclub screen (App.tsx).
 */
export function CalloutPopup({ inside = false }: { inside?: boolean }) {
  const incoming = useCallout((s) => s.incoming);
  const join = useCallout((s) => s.join);
  const name = useName((s) => s.name);
  const open = useArena((s) => s.open);
  // saved fights whose time has come (one copy of the popup does the checking)
  useEffect(() => {
    if (inside) return;
    checkLater();
    const t = setInterval(checkLater, 10_000);
    return () => clearInterval(t);
  }, []);
  // a room to join: once you have a name, open the Fightclub (it walks you in)
  useEffect(() => {
    if (!inside && join && name && !open) useArena.getState().show(BRAWLORE);
  }, [inside, join, name, open]);
  // the Fightclub screen covers the app, so it has its own copy of the popup
  if (!incoming || open !== inside) return null;
  const late = incoming.at - Date.now() > 60_000;
  return (
    <View style={styles.popWrap} pointerEvents="box-none">
      <View style={[styles.popCard, styles.flyer]}>
        <T v="label" style={{ color: '#c0202e', letterSpacing: 2 }}>
          GALI FIGHTCLUB
        </T>
        <T v="display" style={{ fontSize: 26, lineHeight: 26, color: '#c0202e' }}>
          {incoming.mine ? 'YOUR CALLOUT IS ON' : `${incoming.from.toUpperCase()} CALLED YOU OUT!`}
        </T>
        <T style={{ fontSize: 12, color: '#2a1a20' }}>
          {incoming.mine
            ? `Time to fight ${incoming.rivals.join(', ')}. Room ${incoming.code}.`
            : `${incoming.n > 2 ? 'A free for all' : 'A 1v1'}${late ? ` at ${fmtWhen(incoming.at, false)}` : ''} in room ${incoming.code}.`}
        </T>
        <View style={styles.row}>
          <Btn
            kind="red"
            label="FIGHT"
            onPress={() => {
              play('select');
              useCallout.setState({ incoming: null, join: incoming });
            }}
            style={{ flex: 1.3 }}
          />
          <Btn kind="plain" label="LATER" onPress={() => useCallout.setState({ incoming: null })} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}
