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
import { TUTORIAL_STEPS, useProTutorial, useTutorial } from '../game/tutorial';
import { useTut, type TutTargetId } from '../game/tutTargets';
import { INTRO_MINE, useCoach } from '../game/coach';
import { Pointer, useTutActive } from './Pointer';
import { useMinePanel } from './MineAnywhere';
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

/* ---------------- computer: LITE, step by step, an arrow on the real button ---------------- */
interface DeskStep {
  icon: PixName;
  title: string;
  body: string;
  target: TutTargetId | null;
  /** where the arrow aims along the target (0 = its left edge) */
  at?: number;
  /** how much of the target's width glows (the first of a row of buttons) */
  span?: number;
  label?: string;
  waits?: string;
}
const DESK_STEPS: DeskStep[] = [
  { icon: 'ore', title: 'Mine ORE in 3 clicks', body: 'Every round, about a minute, one of 25 spots strikes gold and mines ORE. LITE puts your SOL on all 25, so you are always on the gold spot.', target: null },
  { icon: 'grid', title: 'LITE is on', body: 'LITE covers every spot for you. Nothing to pick on the map.', target: 'tab-lite', at: 0.1, label: 'LITE' },
  { icon: 'sol', title: 'Add SOL', body: 'Click +0.01. That is one round. Only mine with SOL you can afford to lose.', target: 'quick', at: 0.04, span: 0.24, label: 'CLICK', waits: 'Moves on when you add SOL' },
  { icon: 'pick', title: 'Press DEPLOY', body: 'Approve it in your wallet. Your SOL goes on ORE’s board for this round.', target: 'deploy', at: 0.04, label: 'CLICK', waits: 'Moves on when your SOL is in' },
  { icon: 'gift', title: 'Claim what you mined', body: 'When the round ends, most of your SOL comes back plus the ORE you mined. It waits in Unclaimed under the panel. Claim any time.', target: 'unclaimed', at: 0.04 },
];

const PRO_TOUR: DeskStep[] = [
  { icon: 'grid', title: 'PRO: you pick the spots', body: 'Click spots on the map to choose them yourself, or set how many with − and +. ALL covers every spot.', target: 'pro-tiles', at: 0.04 },
  { icon: 'sol', title: 'SOL a round', body: 'This SOL is split evenly over your spots. Fewer spots: bigger share if one strikes, but you miss more rounds.', target: 'amount', at: 0.04 },
  { icon: 'pick', title: 'Deploy', body: 'Same as LITE: press DEPLOY, approve, wait for the strike. Back to LITE any time.', target: 'deploy', at: 0.04 },
];

function DeskCard({ s, step, total, onNext, onClose, tag }: { s: DeskStep; step: number; total: number; onNext: () => void; onClose: () => void; tag: string }) {
  const L = useLayout();
  useTutActive(true);
  return (
    <>
      <Pointer target={s.target} at={s.at} span={s.span} label={s.label} />
      <View pointerEvents="box-none" style={[styles.wrap, { top: TOP_H + GUTTER * 2 + 8, left: RAIL_W + GUTTER, right: L.side + GUTTER * 2 }]}>
        <PixelBox fill="rgba(8,13,32,0.96)" hi={COLORS.gold} lo="#04060f" shadow={1} style={styles.card}>
          <View style={styles.head}>
            <PixIcon name={s.icon} size={28} />
            <View style={{ flex: 1 }}>
              <T v="label" style={{ color: COLORS.teal }}>
                {tag} · {step + 1}/{total}
              </T>
              <T v="display" style={{ fontSize: 22, lineHeight: 23, color: COLORS.gold }}>
                {s.title}
              </T>
            </View>
            <IconBtn onPress={onClose} label="Close the tutorial">
              <PixIcon name="close" size={16} />
            </IconBtn>
          </View>
          <T v="body" style={{ fontSize: 14, lineHeight: 19 }}>
            {s.body}
          </T>
          {s.target ? (
            <T v="label" style={{ color: COLORS.gold }}>
              Follow the arrow →
            </T>
          ) : null}
          <View style={styles.foot}>
            <View style={styles.dots}>
              {Array.from({ length: total }, (_, k) => (
                <View key={k} style={[styles.dot, { backgroundColor: k <= step ? COLORS.gold : '#22356f' }]} />
              ))}
            </View>
            {s.waits ? (
              <T v="muted" style={{ fontSize: 12, flexShrink: 1, textAlign: 'right' }}>
                {s.waits}
              </T>
            ) : null}
            <Btn small kind={s.waits ? 'ghost' : 'gold'} label={step === total - 1 ? 'Got it' : s.waits ? 'Skip step' : 'Next'} onPress={onNext} />
          </View>
        </PixelBox>
      </View>
    </>
  );
}

function DeskMineTutorial() {
  const where = useLobby((s) => s.where);
  const onboarded = useGame((s) => s.save.onboarded);
  const tab = useGame((s) => s.dockTab);
  const inRound = useGame((s) => Boolean(s.pending || s.run));
  const amount = useTut((s) => s.liteAmount);
  const { step, desk, deskDone, start, next, close } = useTutorial();
  const pro = useProTutorial();
  const introBusy = useCoach((c) => c.introStep >= 0 && c.introStep < INTRO_MINE);

  // the first landing on the island (after the lobby intro) starts LITE; it opens the panel on LITE
  useEffect(() => {
    if (where === 'island' && onboarded && !deskDone && step < 0 && !introBusy) {
      const t = setTimeout(() => {
        useMinePanel.getState().setHidden(false);
        useGame.getState().setDockTab('lite');
        start(true);
        useCoach.getState().finishIntro();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [where, onboarded, deskDone, step, start, introBusy]);
  useEffect(() => {
    if (!desk) return;
    if (step === 2 && amount > 0) next();
    if (step === 3 && inRound) next();
  }, [desk, step, amount, inRound, next]);
  // PRO's own short tour, the first time a miner switches to PRO
  useEffect(() => {
    if (where === 'island' && tab === 'pro' && !pro.done && pro.step < 0 && step < 0) pro.start();
  }, [where, tab, pro, step]);

  if (where !== 'island') return null;
  if (desk && step >= 0 && step < DESK_STEPS.length) return <DeskCard key={`l${step}`} s={DESK_STEPS[step]} step={step} total={DESK_STEPS.length} onNext={next} onClose={close} tag="LITE MINING" />;
  if (pro.step >= 0 && tab === 'pro') return <DeskCard key={`p${pro.step}`} s={PRO_TOUR[pro.step]} step={pro.step} total={PRO_TOUR.length} onNext={pro.next} onClose={pro.close} tag="PRO MINING" />;
  return null;
}

export function MineTutorial() {
  const { desktop } = useLayout();
  if (desktop && !LANDSCAPE_APP) return <DeskMineTutorial />;
  return <PhoneMineTutorial />;
}

function PhoneMineTutorial() {
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
