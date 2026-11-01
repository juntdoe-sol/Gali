/**
 * The University of ORE: Hardhat Chad's lessons on how ORE mining works and what players do about it.
 *
 * Opens when you tap Chad (he stands at the foot of the University's steps, in the north-east of ORE Island),
 * tap the University's door, or walk up its steps. The facts come from two write-ups, linked at the bottom:
 * Blockworks' ORE dashboard primer and QuickNode's ORE mining guide. Numbers are as those sources gave them.
 */
import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View, type ImageStyle } from 'react-native';
import { create } from 'zustand';
import { COLORS } from '../game/constants';
import { loadJson, saveJson } from '../game/storage';
import { Btn, PixelBox, Scrim, T, Window } from './kit';
import { useLayout } from './layout';

const CHAD = require('../../assets/ui/chad.png');
const PIX = { imageRendering: 'pixelated' } as ImageStyle;

export const useUni = create<{ open: boolean }>(() => ({ open: false }));
export const openUni = () => useUni.setState({ open: true });

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
  const { w } = useLayout();
  const wide = w >= 700;
  const [sel, setSel] = useState<number | null>(null);
  const [read, setRead] = useState<number[]>([]);
  useEffect(() => {
    void loadJson<number[]>(READ_KEY, []).then((r) => setRead(Array.isArray(r) ? r : []));
  }, []);
  useEffect(() => {
    if (open) setSel(wide ? 0 : null);
  }, [open, wide]);
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
      <Window title="UNIVERSITY OF ORE" sub={`Lessons from Hardhat Chad  ·  ${read.length}/${LESSONS.length} read`} onClose={close} width={880} style={{ maxHeight: '92%' }}>
        {wide ? (
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
});
