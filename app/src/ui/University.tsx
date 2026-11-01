/**
 * The University of ORE: Hardhat Chad's lessons on how ORE mining works and what players do about it.
 *
 * Opens when you tap Chad (he stands at the foot of the University's steps, in the north-east of ORE Island),
 * tap the University's door, or walk up its steps. The facts come from two write-ups, linked at the bottom:
 * Blockworks' ORE dashboard primer and QuickNode's ORE mining guide. Numbers are as those sources gave them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, TextInput, View, type ImageStyle } from 'react-native';
import { create } from 'zustand';
import { COLORS } from '../game/constants';
import { CHAD_ASK, CHAD_BYE, CHAD_PICK, ORE_QNA } from '../game/oreQna';
import { signIn, useDm } from '../game/dm';
import { playAsk } from '../game/play';
import { loadJson, saveJson } from '../game/storage';
import { useGame } from '../game/store';
import { publicKey, restBase } from '../game/world';
import { Btn, INPUT, PixelBox, Scrim, T, Window } from './kit';
import { useLayout } from './layout';

const CHAD = require('../../assets/ui/chad.png');
const PIX = { imageRendering: 'pixelated' } as ImageStyle;

type UniTab = 'lessons' | 'tips';
export const useUni = create<{ open: boolean; start: number; near: boolean; tab: UniTab; at: [number, number] | null }>(() => ({ open: false, start: 0, near: false, tab: 'lessons', at: null }));
export const openUni = (start = 0, tab: UniTab = 'lessons') => useUni.setState({ open: true, start, tab });
/** the engine says your miner walked up to Chad, or away */
export const nearChad = (near: boolean) => useUni.setState(near ? { near } : { near, at: null });
/** where Chad's head is on screen (CSS px): his speech bubble hangs above it */
export const chadAt = (x: number, y: number) => useUni.setState({ at: [x, y] });

const SOURCES = {
  bw: { name: 'Blockworks: ORE dashboard primer', url: 'https://blockworks.com/insights/ore-dashboard-primer' },
  qn: { name: 'QuickNode: ORE mining guide', url: 'https://www.quicknode.com/guides/solana-development/3rd-party-integrations/ore-mining' },
} as const;
type Src = keyof typeof SOURCES;

interface Lesson {
  title: string;
  /** what it is, in a few short lines */
  body: string[];
  /** Chad's own take */
  chad: string;
  src: Src[];
}

const LESSONS: Lesson[] = [
  {
    title: 'The board',
    body: [
      'ORE runs on a 5x5 board: 25 squares. A round lasts 60 seconds.',
      'You put SOL on one square or many. When the round ends, one square wins at random.',
      'Each square has a 1 in 25 chance (4%). Cover 5 squares and you sit on the winner about 20% of the time.',
    ],
    chad: 'Nobody can call the winning square. Anyone who says they can is selling something.',
    src: ['qn'],
  },
  {
    title: 'Who gets paid',
    body: [
      'The SOL on the 24 losing squares goes to the miners on the winning square, split by stake.',
      'Hold 10% of the SOL on the winning square and you take 10% of the losing pot.',
      'A 10% fee comes off the losing SOL. The protocol uses it to buy back ORE.',
    ],
    chad: 'Win a square nobody else wanted and the pot is all yours.',
    src: ['bw', 'qn'],
  },
  {
    title: 'The ORE reward',
    body: [
      'Every round mints 1 new ORE on top of the SOL.',
      'Some rounds the winners split it by stake. Other rounds one winner takes the whole ORE, picked at random weighted by stake.',
    ],
    chad: 'A small stake can still walk off with a full ORE. Small odds, not zero.',
    src: ['bw', 'qn'],
  },
  {
    title: 'The Motherlode',
    body: [
      'Every round adds 0.2 ORE to the Motherlode pool, whichever square wins.',
      'Each round has a 1 in 625 chance (0.16%) of paying the whole pool to the winning square, split by stake.',
      'That is about 625 rounds between hits on average, for a pool near 125 ORE. The gap swings a lot either way.',
    ],
    chad: 'You only catch a Motherlode if you are on the board when it drops. Show up steady.',
    src: ['bw', 'qn'],
  },
  {
    title: 'Spread or stack',
    body: [
      'Spread small amounts over 10 to 15 squares: you win often, in small pieces.',
      'Stack bigger amounts on 2 to 5 squares: you win less often, in bigger pieces, with bigger swings.',
    ],
    chad: 'Spreading keeps you calm. Stacking keeps you up at night. Pick the one you can stomach.',
    src: ['qn'],
  },
  {
    title: 'Start small',
    body: [
      'QuickNode suggests 0.5 to 1 SOL to start, and 0.005 to 0.01 SOL per square while you learn.',
      'Most rounds are losses. Never deploy more in a round than you can afford to lose.',
    ],
    chad: 'Pick your budget before the first round, not after the tenth.',
    src: ['qn'],
  },
  {
    title: 'Timing',
    body: [
      'Blockworks found late deployers, in the last 20+ slots of a round, had higher average P&L over 1, 7, 30 and 90 day windows.',
      'Their read: players who check each square before committing SOL get an edge.',
      'That is past data. It is not a promise about the next round.',
    ],
    chad: 'Look at where the SOL is piled before you throw yours in.',
    src: ['bw'],
  },
  {
    title: 'Autominers',
    body: [
      'Autominers have placed about 75% or more of the SOL deployed every week since ORE v3 launched.',
      'Auto Mode keeps you in every round after one approval. Manual Mode is better for learning.',
      'In Gali, Autopilot does the auto part for you.',
    ],
    chad: 'Learn it by hand first. Then let the machine dig while you sleep.',
    src: ['bw', 'qn'],
  },
  {
    title: 'Refining',
    body: [
      'Claiming your mined ORE costs a 10% refining fee.',
      'That fee does not go to the protocol. It goes to every miner who has not claimed yet, split by their unclaimed ORE.',
      'Blockworks measured that refining yield at about 70% APY on a rolling 30 days, ranging from 50% to over 90%.',
    ],
    chad: 'Every miner who cashes out early pays the ones who wait. Be the one who waits, if you can.',
    src: ['bw', 'qn'],
  },
  {
    title: 'Buybacks and staking',
    body: [
      'The protocol buys ORE back with its fees. 90% of that ORE is buried, which works like a burn. 10% goes to stakers.',
      'Blockworks measured staked ORE (stORE) at about 17% implied APY over 90 days.',
      'ORE has a max supply of 3 million.',
    ],
    chad: 'Refined ORE sitting idle in your wallet is a pickaxe left in the shed.',
    src: ['bw', 'qn'],
  },
];

const READ_KEY = 'gali-uni-read-v1';

export function University() {
  const open = useUni((s) => s.open);
  const start = useUni((s) => s.start);
  const tab = useUni((s) => s.tab);
  const setTab = (t: UniTab) => useUni.setState({ tab: t });
  const { w } = useLayout();
  const wide = w >= 700;
  const [sel, setSel] = useState<number | null>(null);
  const [read, setRead] = useState<number[]>([]);
  useEffect(() => {
    void loadJson<number[]>(READ_KEY, []).then((r) => setRead(Array.isArray(r) ? r : []));
  }, []);
  useEffect(() => {
    if (open) setSel(start > 0 ? start : wide ? 0 : null);
  }, [open, wide, start]);
  useEffect(() => {
    if (sel == null || read.includes(sel)) return;
    const next = [...read, sel];
    setRead(next);
    saveJson(READ_KEY, next, 0);
  }, [sel, read]);
  if (!open) return null;
  const close = () => useUni.setState({ open: false });
  const cur = sel != null ? LESSONS[sel] : null;

  const list = (
    <ScrollView style={wide ? styles.list : undefined} contentContainerStyle={{ gap: 4, paddingRight: wide ? 6 : 0 }}>
      {LESSONS.map((l, i) => {
        const on = i === sel;
        const done = read.includes(i);
        return (
          <Pressable key={l.title} onPress={() => setSel(i)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
            {(st) => (
              <PixelBox
                fill={on ? 'rgba(255,201,60,0.16)' : (st as { hovered?: boolean }).hovered ? '#1a2850' : '#0b1430'}
                hi={on ? COLORS.gold : '#22356f'}
                lo="#04060f"
                style={styles.row}
              >
                <T v="display" style={{ fontSize: 15, lineHeight: 16, color: COLORS.muted, width: 20 }}>
                  {String(i + 1).padStart(2, '0')}
                </T>
                <T v="display" numberOfLines={1} style={{ fontSize: 17, lineHeight: 18, flex: 1, color: on ? COLORS.gold : COLORS.text }}>
                  {l.title}
                </T>
                {done ? (
                  <T v="tiny" style={{ fontSize: 9, color: COLORS.green }}>
                    READ
                  </T>
                ) : null}
              </PixelBox>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const lesson = cur ? (
    <ScrollView style={wide ? styles.page : undefined} contentContainerStyle={{ gap: 10 }}>
      <T v="display" style={{ fontSize: 26, lineHeight: 28, color: COLORS.gold }}>
        {cur.title.toUpperCase()}
      </T>
      {cur.body.map((b) => (
        <T key={b} style={{ fontSize: 15, lineHeight: 21 }}>
          {b}
        </T>
      ))}
      <PixelBox fill="rgba(255,201,60,0.10)" hi={COLORS.gold} lo="#04060f" style={styles.say}>
        <Image source={CHAD} style={[{ width: 40, height: 40 }, PIX]} fadeDuration={0} />
        <View style={{ flex: 1 }}>
          <T v="tiny" style={{ fontSize: 9, color: COLORS.gold }}>
            HARDHAT CHAD SAYS
          </T>
          <T v="bold" style={{ fontSize: 14, lineHeight: 19 }}>
            {cur.chad}
          </T>
        </View>
      </PixelBox>
      <View style={{ gap: 2 }}>
        {cur.src.map((k) => (
          <Pressable key={k} onPress={() => void Linking.openURL(SOURCES[k].url)} accessibilityRole="link">
            <T v="muted" style={{ fontSize: 12, textDecorationLine: 'underline' }}>
              Source: {SOURCES[k].name}
            </T>
          </Pressable>
        ))}
      </View>
      <View style={styles.nav}>
        {sel! > 0 ? <Btn small label="PREV" onPress={() => setSel(sel! - 1)} /> : <View />}
        {sel! < LESSONS.length - 1 ? <Btn small kind="gold" label="NEXT LESSON" onPress={() => setSel(sel! + 1)} /> : <Btn small kind="gold" label="DONE" onPress={close} />}
      </View>
    </ScrollView>
  ) : null;

  return (
    <Scrim onPress={close}>
      <Window title="UNIVERSITY OF ORE" sub={tab === 'tips' ? 'Tips and strategies from Gali miners' : `Lessons from Hardhat Chad  ·  ${read.length}/${LESSONS.length} read`} onClose={close} width={880} style={{ maxHeight: '92%' }}>
        <View style={styles.tabs}>
          {(['lessons', 'tips'] as UniTab[]).map((t) => (
            <Btn key={t} small kind={tab === t ? 'gold' : 'ghost'} label={t === 'lessons' ? "CHAD'S LESSONS" : "MINERS' TIPS"} onPress={() => setTab(t)} />
          ))}
        </View>
        {tab === 'tips' ? (
          <TipsBoard />
        ) : wide ? (
          <View style={styles.body}>
            <View style={styles.side}>
              <View style={styles.hello}>
                <Image source={CHAD} style={[{ width: 72, height: 72 }, PIX]} fadeDuration={0} accessibilityLabel="Hardhat Chad" />
                <T style={{ flex: 1, fontSize: 13, lineHeight: 18, color: COLORS.muted }}>
                  Hardhat Chad here. I have dug more squares than you have had hot dinners. Pick a lesson.
                </T>
              </View>
              {list}
            </View>
            {lesson}
          </View>
        ) : cur ? (
          <View style={{ flexShrink: 1, gap: 8 }}>
            <Btn small kind="ghost" label="ALL LESSONS" onPress={() => setSel(null)} style={{ alignSelf: 'flex-start' }} />
            {lesson}
          </View>
        ) : (
          <View style={{ flexShrink: 1, gap: 8 }}>
            <View style={styles.hello}>
              <Image source={CHAD} style={[{ width: 64, height: 64 }, PIX]} fadeDuration={0} accessibilityLabel="Hardhat Chad" />
              <T style={{ flex: 1, fontSize: 13, lineHeight: 18, color: COLORS.muted }}>
                Hardhat Chad here. I have dug more squares than you have had hot dinners. Pick a lesson.
              </T>
            </View>
            {list}
          </View>
        )}
      </Window>
    </Scrim>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', gap: 14, flexShrink: 1, minHeight: 420 },
  side: { width: 290, gap: 8 },
  list: { flexGrow: 0, maxHeight: 440 },
  page: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
  hello: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  say: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tip: { padding: 10, gap: 6 },
  tipFoot: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { ...INPUT, position: 'relative', zIndex: 1, height: 64, paddingTop: 8, textAlignVertical: 'top', color: '#ffffff' },
  chatWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 40 },
  chat: { padding: 10, gap: 8 },
  chatHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  chatBtns: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 9, paddingVertical: 6 },
});

/**
 * Walk up to Hardhat Chad and he asks if you have questions: a chat card with ready questions about ORE.
 * Pick one and he answers; from an answer you can ask another or open the full lesson in the University.
 * Closing it keeps it shut until you walk away from him and back.
 */
export function ChadChat() {
  const near = useUni((s) => s.near);
  const uniOpen = useUni((s) => s.open);
  const { w, h, desktop, rail, side } = useLayout();
  const at = useUni((s) => s.at);
  const [pick, setPick] = useState<number | null>(null);
  const [shut, setShut] = useState(false);
  /** he asks first: 'ask' until you answer, 'yes' shows the questions, 'no' is his goodbye */
  const [step, setStep] = useState<'ask' | 'yes' | 'no'>('ask');
  useEffect(() => {
    if (!near) {
      setShut(false);
      setPick(null);
      setStep('ask');
    }
  }, [near]);
  // a no: he says his piece, then the bubble goes until you walk away and come back
  useEffect(() => {
    if (step !== 'no') return;
    const t = setTimeout(() => setShut(true), 2600);
    return () => clearTimeout(t);
  }, [step]);
  if (!near || shut || uniOpen || !at) return null;
  const qa = pick != null ? ORE_QNA[pick] : null;
  // a speech bubble out of Chad's mouth: above his head, its tail pointing down at him, kept on screen
  const bw = Math.min(desktop ? 520 : 400, w - rail - side - 16);
  const left = Math.max(rail + 8, Math.min(w - side - bw - 8, at[0] - bw / 2));
  const room = Math.max(150, at[1] - (desktop ? 70 : 150));
  const tail = Math.max(18, Math.min(bw - 18, at[0] - left));
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 40 }]}>
      <View pointerEvents="box-none" style={{ position: 'absolute', left, width: bw, bottom: h - at[1] + 14 }}>
      <PixelBox fill="#fbf6e6" hi="#ffffff" lo="#c9bfa5" edge="#16120e" style={[styles.chat, { width: bw, maxHeight: room }]}>
        <View style={styles.chatHead}>
          <View style={{ flex: 1 }}>
            <T v="tiny" style={{ fontSize: 9, color: '#a8740a' }}>
              HARDHAT CHAD
            </T>
            <T v="tiny" style={{ fontSize: 8, color: '#7a52c8', marginTop: -2 }}>
              Darkweb Version
            </T>
            <T v="bold" style={{ fontSize: 15, lineHeight: 20, color: '#1c1820' }}>
              {qa ? qa.a : step === 'no' ? CHAD_BYE : step === 'yes' ? CHAD_PICK : CHAD_ASK}
            </T>
          </View>
          <Pressable onPress={() => setShut(true)} accessibilityRole="button" accessibilityLabel="Close chat" hitSlop={10}>
            <T v="display" style={{ fontSize: 20, lineHeight: 20, color: '#8a8070' }}>
              X
            </T>
          </Pressable>
        </View>
        {step === 'ask' ? (
          <View style={styles.chatBtns}>
            <Btn small label="NO" onPress={() => setStep('no')} />
            <Btn small kind="gold" label="YES" onPress={() => setStep('yes')} />
          </View>
        ) : step === 'no' ? null : qa ? (
          <View style={styles.chatBtns}>
            <Btn small label="ASK ANOTHER" onPress={() => setPick(null)} />
            {qa.lesson != null ? <Btn small kind="gold" label="FULL LESSON" onPress={() => openUni(qa.lesson)} /> : null}
          </View>
        ) : (
          <ScrollView style={{ maxHeight: Math.max(90, room - 70) }} contentContainerStyle={styles.chips} nestedScrollEnabled>
            {ORE_QNA.map((x, i) => (
              <Pressable key={x.q} onPress={() => setPick(i)} accessibilityRole="button">
                {(st) => (
                  <PixelBox fill={(st as { hovered?: boolean }).hovered ? '#1a2850' : '#0b1430'} hi="#22356f" lo="#04060f" style={styles.chip}>
                    <T style={{ fontSize: 13, lineHeight: 16 }}>{x.q}</T>
                  </PixelBox>
                )}
              </Pressable>
            ))}
            <Pressable onPress={() => openUni(0)} accessibilityRole="button">
              <PixelBox fill="rgba(255,201,60,0.16)" hi={COLORS.gold} lo="#04060f" style={styles.chip}>
                <T style={{ fontSize: 13, lineHeight: 16, color: COLORS.gold }}>Open the University lessons</T>
              </PixelBox>
            </Pressable>
            <Pressable onPress={() => openUni(0, 'tips')} accessibilityRole="button">
              <PixelBox fill="rgba(47,199,221,0.14)" hi="#2fc7dd" lo="#04060f" style={styles.chip}>
                <T style={{ fontSize: 13, lineHeight: 16, color: '#2fc7dd' }}>Read tips from other miners</T>
              </PixelBox>
            </Pressable>
          </ScrollView>
        )}
      </PixelBox>
      {/* the tail, pointing down at Chad */}
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -16, left: tail - 12, width: 24, height: 18 }}>
        {[
          [0, 24],
          [4, 18],
          [8, 12],
          [12, 6],
        ].map(([y, wd]) => (
          <View key={y} style={{ position: 'absolute', top: y, left: (24 - wd) / 2, width: wd, height: 4, backgroundColor: '#fbf6e6', borderLeftWidth: 2, borderRightWidth: 2, borderColor: '#16120e' }} />
        ))}
        <View style={{ position: 'absolute', top: 16, left: 10, width: 4, height: 2, backgroundColor: '#16120e' }} />
      </View>
      </View>
    </View>
  );
}

/* ---------------- miners' tips ---------------- */

interface Tip {
  id: number;
  name: string;
  body: string;
  ups: number;
  at: string;
}
const VOTED_KEY = 'gali-uni-voted-v1';
const TIP_MAX = 200;

function ago(at: string) {
  const s = Math.max(0, (Date.now() - Date.parse(at)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/**
 * Tips and strategies shared by Gali miners: the best first (or the newest), an upvote and a report on each.
 * Signed-in miners with a Gali name can share 3 a day. A tip with 3 reports hides itself (sql/uni-tips.sql).
 */
function TipsBoard() {
  const me = useDm((s) => s.me);
  const owner = useGame((s) => s.wallet.owner);
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [tips, setTips] = useState<Tip[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [voted, setVoted] = useState<Record<string, true>>({});
  useEffect(() => {
    void loadJson<Record<string, true>>(VOTED_KEY, {}).then((v) => setVoted(v && typeof v === 'object' ? v : {}));
  }, []);
  const load = useCallback(async () => {
    const base = restBase();
    if (!base) return setTips([]);
    const order = sort === 'top' ? 'ups.desc,at.desc' : 'at.desc';
    try {
      const r = await fetch(`${base}/rest/v1/gali_uni_tips?select=id,name,body,ups,at&order=${order}&limit=60`, { headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}` } });
      setTips(r.ok ? ((await r.json()) as Tip[]) : []);
    } catch {
      setTips([]);
    }
  }, [sort]);
  useEffect(() => {
    void load();
  }, [load]);

  const share = async () => {
    const body = draft.trim();
    if (body.length < 8) return setNote('Write a bit more: at least 8 characters.');
    setBusy(true);
    setNote(null);
    const r = await playAsk<{ id: number }>('tip', { body });
    setBusy(false);
    if (!r.ok) return setNote(r.error);
    setDraft('');
    setNote('Shared. Thanks for teaching the island.');
    setSort('new');
    void load();
  };
  const vote = async (t: Tip, kind: 'up' | 'report') => {
    const k = `${t.id}:${kind}`;
    if (voted[k]) return;
    const next = { ...voted, [k]: true as const };
    setVoted(next);
    saveJson(VOTED_KEY, next, 0);
    if (kind === 'up') setTips((l) => l?.map((x) => (x.id === t.id ? { ...x, ups: x.ups + 1 } : x)) ?? l);
    else setTips((l) => l?.filter((x) => x.id !== t.id) ?? l);
    const r = await playAsk('tipvote', { id: t.id, kind });
    if (!r.ok) setNote(r.error);
  };

  return (
    <View style={{ flexShrink: 1, gap: 10, minHeight: 360 }}>
      {me ? (
        <View style={{ gap: 6 }}>
          <TextInput
            value={draft}
            onChangeText={(v) => setDraft(v.slice(0, TIP_MAX))}
            placeholder="Share a mining tip or strategy. What works for you?"
            placeholderTextColor="#6f7fae"
            multiline
            maxLength={TIP_MAX}
            style={styles.input}
          />
          <View style={styles.tipFoot}>
            <T v="muted" style={{ fontSize: 12, flex: 1 }}>
              {draft.length}/{TIP_MAX} · 3 tips a day · no links
            </T>
            <Btn small kind="gold" label={busy ? 'SHARING' : 'SHARE TIP'} disabled={busy || draft.trim().length < 8} onPress={() => void share()} />
          </View>
        </View>
      ) : (
        <PixelBox fill="#0b1430" hi="#22356f" lo="#04060f" style={[styles.tip, { flexDirection: 'row', alignItems: 'center' }]}>
          <T style={{ flex: 1, fontSize: 13, color: COLORS.muted }}>{owner ? 'Sign in to share your own tips and vote on others.' : 'Connect a wallet and sign in to share your own tips.'}</T>
          {owner ? <Btn small kind="gold" label="SIGN IN" onPress={() => void signIn().catch((e) => setNote((e as Error).message))} /> : null}
        </PixelBox>
      )}
      {note ? (
        <T v="bold" style={{ fontSize: 13, color: COLORS.gold }}>
          {note}
        </T>
      ) : null}
      <View style={styles.tabs}>
        <Btn small kind={sort === 'top' ? 'teal' : 'ghost'} label="TOP" onPress={() => setSort('top')} />
        <Btn small kind={sort === 'new' ? 'teal' : 'ghost'} label="NEW" onPress={() => setSort('new')} />
      </View>
      <ScrollView style={{ flexShrink: 1, maxHeight: 460 }} contentContainerStyle={{ gap: 6 }}>
        {tips === null ? (
          <T v="muted">Loading tips...</T>
        ) : tips.length === 0 ? (
          <T v="muted">No tips yet. Be the first to share one.</T>
        ) : (
          tips.map((t) => {
            const up = voted[`${t.id}:up`];
            return (
              <PixelBox key={t.id} fill="#0b1430" hi="#22356f" lo="#04060f" style={styles.tip}>
                <T style={{ fontSize: 14, lineHeight: 19 }}>{t.body}</T>
                <View style={styles.tipFoot}>
                  <T v="tiny" style={{ fontSize: 9, color: COLORS.gold, flex: 1 }}>
                    {t.name.toUpperCase()} · {ago(t.at)}
                  </T>
                  <Pressable onPress={() => (me ? void vote(t, 'up') : setNote('Sign in to vote.'))} accessibilityRole="button" accessibilityLabel="Upvote" hitSlop={8}>
                    <T v="display" style={{ fontSize: 16, color: up ? COLORS.green : COLORS.text }}>
                      +{t.ups} USEFUL
                    </T>
                  </Pressable>
                  <Pressable onPress={() => (me ? void vote(t, 'report') : setNote('Sign in to report.'))} accessibilityRole="button" accessibilityLabel="Report" hitSlop={8}>
                    <T v="tiny" style={{ fontSize: 9, color: COLORS.muted }}>
                      REPORT
                    </T>
                  </Pressable>
                </View>
              </PixelBox>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
