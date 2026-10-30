/**
 * How to play, on a computer: a list of topics on the left, and on the right a picture of the one you picked.
 * ORE mining comes first and is taught as LITE in four steps (open MINE, add SOL, DEPLOY, claim), with a
 * mock of the real deploy panel that plays the steps out. Phones keep the plain list (Lobby.tsx).
 */
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { Btn, Kbd, PixelBox, Scrim, T, U, Window } from './kit';
import { useMinePanel } from './MineAnywhere';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

export interface HowItem {
  icon: PixName;
  title: string;
  body: string;
}

/** The keys each topic uses, shown as key caps. */
const KEYS: Record<string, string[]> = {
  'Walk around': ['W', 'A', 'S', 'D', 'CLICK'],
  'Chat and stickers': ['C', 'ENTER'],
  Brawl: ['F', 'LMB', 'SPC'],
  'Smash things': ['F', 'LMB'],
  'Carts and scooters': ['E'],
  'Back to the lobby': ['L', 'G'],
};

const MINE = 'Mine ORE';
const STEPS = [
  { title: 'Open MINE, keep LITE', body: 'LITE covers all 25 spots, so one of them is always the gold spot. No picking needed.' },
  { title: 'Add SOL', body: 'Tap +0.01 to start small. That is your deploy for one round.' },
  { title: 'Press DEPLOY', body: 'Approve it in your wallet. Your SOL goes on ORE’s board for this round.' },
  { title: 'Claim when it ends', body: 'Most of your SOL comes back, plus the ORE you mined. Both wait in Unclaimed: claim any time.' },
];
const STEP_MS = 2200;

export function DeskHowTo({ items, onClose, onReplay }: { items: HowItem[]; onClose: () => void; onReplay: () => void }) {
  const topics: HowItem[] = [{ icon: 'ore', title: MINE, body: '' }, ...items.filter((i) => !/mine ORE|autopilot/i.test(i.title))];
  const [pick, setPick] = useState(MINE);
  const cur = topics.find((t) => t.title === pick) ?? topics[0];
  const tryIt = () => {
    onClose();
    useGame.getState().setDockTab('lite');
    useMinePanel.getState().setHidden(false);
    useLobby.getState().go('island');
  };
  return (
    <Scrim onPress={onClose}>
      <Window title="HOW TO PLAY" sub="Pick a topic" onClose={onClose} width={900} style={{ maxHeight: '90%' }}>
        <View style={styles.body}>
          <ScrollView style={styles.list} contentContainerStyle={{ gap: 4, paddingRight: 6 }} showsVerticalScrollIndicator>
            {topics.map((t) => {
              const on = t.title === cur.title;
              return (
                <Pressable key={t.title} onPress={() => setPick(t.title)} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                  {(st) => (
                    <PixelBox
                      fill={on ? 'rgba(255,201,60,0.16)' : (st as { hovered?: boolean }).hovered ? '#1a2850' : '#0b1430'}
                      hi={on ? COLORS.gold : '#22356f'}
                      lo="#04060f"
                      style={styles.topic}
                    >
                      <PixIcon name={t.icon} size={22} />
                      <T v="display" style={{ fontSize: 17, lineHeight: 18, color: on ? COLORS.gold : COLORS.text, flex: 1 }} numberOfLines={1}>
                        {t.title}
                      </T>
                      {t.title === MINE ? (
                        <PixelBox fill={COLORS.green} edge="#04140a" u={1} style={styles.start}>
                          <T v="tiny" style={{ color: '#04140a', fontSize: 9, lineHeight: 10 }}>
                            START
                          </T>
                        </PixelBox>
                      ) : null}
                    </PixelBox>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.stage}>{cur.title === MINE ? <MiningLesson onTry={tryIt} /> : <Topic item={cur} />}</View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn kind="ghost" label="REPLAY MINING TUTORIAL" onPress={onReplay} style={{ flex: 1 }} />
          <Btn kind="gold" label="GOT IT" onPress={onClose} style={{ flex: 1 }} />
        </View>
      </Window>
    </Scrim>
  );
}

/** Any topic but mining: its icon bobbing on a little stage, the keys it uses, and the words. */
function Topic({ item }: { item: HowItem }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 380);
    return () => clearInterval(id);
  }, []);
  const keys = KEYS[item.title];
  return (
    <View style={{ gap: 12 }}>
      <PixelBox fill="#081028" hi="#22356f" lo="#04060f" style={styles.scene}>
        <View style={{ transform: [{ translateY: t % 2 ? -4 : 0 }] }}>
          <PixIcon name={item.icon} size={84} />
        </View>
        <View style={styles.floor} />
      </PixelBox>
      {keys ? (
        <View style={styles.keys}>
          {keys.map((k, i) => (
            <View key={k} style={{ transform: [{ translateY: t % keys.length === i ? U : 0 }] }}>
              <Kbd k={k} />
            </View>
          ))}
        </View>
      ) : null}
      <T v="display" style={{ fontSize: 24, lineHeight: 25, color: COLORS.gold }}>
        {item.title}
      </T>
      <T v="body" style={{ fontSize: 15, lineHeight: 21 }}>
        {item.body}
      </T>
    </View>
  );
}

/** ORE mining with LITE, step by step, over a mock of the deploy panel that plays each step. */
function MiningLesson({ onTry }: { onTry: () => void }) {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS);
    return () => clearInterval(id);
  }, [auto]);
  return (
    <View style={{ gap: 12 }}>
      <T v="display" style={{ fontSize: 24, lineHeight: 25, color: COLORS.gold }}>
        Mine ORE in 4 steps
      </T>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <View style={{ flex: 1, gap: 6 }}>
          {STEPS.map((s, i) => {
            const on = i === step;
            return (
              <Pressable
                key={s.title}
                onPress={() => {
                  setAuto(false);
                  setStep(i);
                }}
              >
                <PixelBox fill={on ? 'rgba(255,201,60,0.14)' : '#0b1430'} hi={on ? COLORS.gold : '#22356f'} lo="#04060f" style={styles.step}>
                  <PixelBox fill={on ? COLORS.gold : '#1a2850'} lo="#04060f" style={styles.stepNo}>
                    <T v="display" style={{ fontSize: 18, lineHeight: 19, color: on ? '#2a1400' : COLORS.muted }}>
                      {i + 1}
                    </T>
                  </PixelBox>
                  <View style={{ flex: 1 }}>
                    <T v="display" style={{ fontSize: 17, lineHeight: 18, color: on ? COLORS.gold : COLORS.text }}>
                      {s.title}
                    </T>
                    {on ? (
                      <T v="body" style={{ fontSize: 13, lineHeight: 18 }}>
                        {s.body}
                      </T>
                    ) : null}
                  </View>
                </PixelBox>
              </Pressable>
            );
          })}
        </View>
        <MockPanel step={step} />
      </View>
      <T v="muted" style={{ fontSize: 12 }}>
        Each round lasts about a minute. Only mine with SOL you can afford to lose.
      </T>
      <Btn kind="gold" label="TRY IT NOW: GO TO ORE ISLAND" onPress={onTry} />
    </View>
  );
}

/** A small copy of the real DEPLOY panel; the part each step is about glows. */
function MockPanel({ step }: { step: number }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setBlink((b) => !b), 300);
    return () => clearInterval(id);
  }, []);
  const glow = (k: number) => (step === k ? { hi: blink ? '#fff1a8' : COLORS.gold } : { hi: '#2d4282' });
  const amount = step >= 1 ? '0.01' : '0';
  return (
    <PixelBox fill="rgba(15,23,52,0.97)" hi="#33498c" lo="#0c1430" shadow={2} style={styles.mock}>
      <T v="display" style={{ fontSize: 16, color: COLORS.gold }}>
        DEPLOY
      </T>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <PixelBox fill="#3a2a7a" lo="#04060f" {...glow(0)} style={[styles.tab, { flex: 1 }]}>
          <T v="display" style={{ fontSize: 14, color: COLORS.gold }}>
            LITE
          </T>
        </PixelBox>
        <View style={[styles.tab, { flex: 1 }]}>
          <T v="display" style={{ fontSize: 14, color: COLORS.muted }}>
            PRO
          </T>
        </View>
      </View>
      <T v="display" style={{ fontSize: 32, lineHeight: 34, textAlign: 'center', color: step >= 1 ? COLORS.gold : COLORS.muted }}>
        {amount}
      </T>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {['+0.01', '+0.1', '+1', 'MAX'].map((b, i) => (
          <PixelBox key={b} fill="#0e1838" lo="#04060f" {...(i === 0 ? glow(1) : { hi: '#2d4282' })} style={[styles.tab, { flex: 1, paddingVertical: 5 }]}>
            <T v="display" style={{ fontSize: 12, color: COLORS.text }}>
              {b}
            </T>
          </PixelBox>
        ))}
      </View>
      <PixelBox fill={step >= 1 ? COLORS.gold : '#2a2250'} lo="#04060f" {...glow(2)} style={[styles.tab, { paddingVertical: 8 }]}>
        <T v="display" style={{ fontSize: 15, color: step >= 1 ? '#2a1400' : COLORS.muted }}>
          {step >= 1 ? `DEPLOY ${amount} SOL` : 'ENTER AMOUNT'}
        </T>
      </PixelBox>
      <PixelBox fill="#0b1430" lo="#04060f" {...glow(3)} style={styles.unclaimed}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <PixIcon name="gift" size={14} />
          <T v="display" style={{ fontSize: 13, color: COLORS.gold, flex: 1 }}>
            UNCLAIMED
          </T>
          <T v="display" style={{ fontSize: 13, color: step >= 3 ? COLORS.green : COLORS.muted }}>
            {step >= 3 ? '+0.009 SOL' : '0 SOL'}
          </T>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <PixIcon name="ore" size={14} />
          <T v="display" style={{ fontSize: 13, color: COLORS.muted, flex: 1 }}>
            ORE
          </T>
          <T v="display" style={{ fontSize: 13, color: step >= 3 ? COLORS.skr : COLORS.muted }}>
            {step >= 3 ? '+ORE' : '0 ORE'}
          </T>
        </View>
      </PixelBox>
    </PixelBox>
  );
}

const styles = StyleSheet.create({
  body: { flexDirection: 'row', gap: 16, flexShrink: 1, minHeight: 420 },
  list: { width: 250, flexGrow: 0 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8 },
  start: { paddingHorizontal: 4, paddingVertical: 2 },
  stage: { flex: 1 },
  scene: { height: 170, alignItems: 'center', justifyContent: 'center' },
  floor: { position: 'absolute', left: 40, right: 40, bottom: 26, height: 4, backgroundColor: '#22356f' },
  keys: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 8 },
  stepNo: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  mock: { width: 250, padding: 10, gap: 8 },
  tab: { alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  unclaimed: { padding: 8, gap: 4 },
});
