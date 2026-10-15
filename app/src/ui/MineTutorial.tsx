/**
 * The step-by-step mining tutorial on ORE Island. Shows the first time a miner lands there,
 * closes with X at any step, and moves on by itself when the miner walks to a spot, picks spots
 * and deploys. Step 2 turns on the island's gold trail to the nearest spot (Snapshot.guide).
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { TUTORIAL_STEPS, useTutorial } from '../game/tutorial';
import { Btn, IconBtn, PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, useLayout } from './layout';

interface Step {
  icon: PixName;
  title: string;
  body: (o: { mouse: boolean; desktop: boolean }) => string;
  /** what moves it on by itself, shown under the text */
  waits?: string;
}
const STEPS: Step[] = [
  {
    icon: 'ore',
    title: 'Welcome to ORE Island',
    body: () => 'Every round, about a minute, ORE strikes gold on one of 25 spots. Put SOL on spots. If yours strikes, you mine ORE. This takes four quick steps.',
  },
  {
    icon: 'star',
    title: 'Walk to a mining spot',
    body: ({ mouse }) => `Follow the gold dots to the ring. ${mouse ? 'Walk with WASD or the arrow keys.' : 'Walk with the joystick, bottom left.'}`,
    waits: 'Moves on when you reach the spot',
  },
  {
    icon: 'pick',
    title: 'Pick your spots',
    body: ({ mouse, desktop }) => `${mouse ? 'Click' : 'Tap'} spots on the island to pick them. Or ${desktop ? 'use the DEPLOY panel on the right' : 'open MINE'} and take All 25, or a Smart pick.`,
    waits: 'Moves on when you pick a spot',
  },
  {
    icon: 'sol',
    title: 'Set your SOL and mine',
    body: () => 'Choose SOL per spot (at least 0.0001), then press MINE THIS ROUND. Your wallet approves it. Only play with SOL you can afford to lose.',
    waits: 'Moves on when your SOL is in',
  },
  {
    icon: 'trophy',
    title: 'Wait for the strike',
    body: () => 'When the clock runs out, ORE picks the gold spot. SOL on the other spots comes back, minus ORE\'s fee. Claim what you win from the wallet panel. Want it hands free? Try AUTOPILOT in PRO.',
  },
];

export function MineTutorial() {
  const where = useLobby((s) => s.where);
  const onboarded = useGame((s) => s.save.onboarded);
  const picked = useGame((s) => s.selected.length);
  const inRound = useGame((s) => Boolean(s.pending || s.run));
  const { step, done, start, next, close } = useTutorial();
  const insets = useSafeAreaInsets();
  const L = useLayout();

  // the first landing on the island starts it
  useEffect(() => {
    if (where === 'island' && onboarded && !done && step < 0) {
      const t = setTimeout(() => start(), 1200);
      return () => clearTimeout(t);
    }
  }, [where, onboarded, done, step, start]);
  // steps 3 and 4 move on by themselves
  useEffect(() => {
    if (step === 2 && picked > 0) next();
    if (step === 3 && inRound) next();
  }, [step, picked, inRound, next]);

  if (where !== 'island' || step < 0 || step >= STEPS.length) return null;
  const s = STEPS[step];
  const pos = L.desktop
    ? { top: TOP_H + GUTTER * 2 + (LANDSCAPE_APP ? 0 : 8), left: RAIL_W + GUTTER, right: L.side + GUTTER * 2 }
    : { top: insets.top + 128, left: 12, right: 12 };
  return (
    <View pointerEvents="box-none" style={[styles.wrap, pos]}>
      <PixelBox fill="rgba(8,13,32,0.95)" hi={COLORS.gold} lo="#04060f" shadow={1} style={[styles.card, LANDSCAPE_APP && styles.cardTight]}>
        <View style={styles.head}>
          <PixIcon name={s.icon} size={LANDSCAPE_APP ? 22 : 28} />
          <View style={{ flex: 1 }}>
            <T v="label" style={{ color: COLORS.teal }}>
              MINING TUTORIAL · {step + 1}/{TUTORIAL_STEPS}
            </T>
            <T v="display" style={{ fontSize: LANDSCAPE_APP ? 18 : 22, lineHeight: LANDSCAPE_APP ? 19 : 23, color: COLORS.gold }}>
              {s.title}
            </T>
          </View>
          <IconBtn onPress={close} label="Close the tutorial">
            <PixIcon name="close" size={16} />
          </IconBtn>
        </View>
        <T v="body" style={{ fontSize: LANDSCAPE_APP ? 13 : 14, lineHeight: LANDSCAPE_APP ? 17 : 19 }}>
          {s.body({ mouse: L.mouse, desktop: L.desktop })}
        </T>
        <View style={styles.foot}>
          <View style={styles.dots}>
            {STEPS.map((_, k) => (
              <View key={k} style={[styles.dot, { backgroundColor: k <= step ? COLORS.gold : '#22356f' }]} />
            ))}
          </View>
          {s.waits ? (
            <T v="muted" style={{ fontSize: 12, flexShrink: 1, textAlign: 'right' }}>
              {s.waits}
            </T>
          ) : null}
          <Btn small kind={s.waits ? 'ghost' : 'gold'} label={step === STEPS.length - 1 ? 'Got it' : s.waits ? 'Skip step' : 'Next'} onPress={next} />
        </View>
      </PixelBox>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center', zIndex: 30 },
  card: { width: '100%', maxWidth: 440, padding: 14, gap: 8 },
  cardTight: { maxWidth: 400, padding: 10, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8 },
});
