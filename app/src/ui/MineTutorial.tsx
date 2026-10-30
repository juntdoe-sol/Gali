/**
 * The step-by-step mining tutorial on ORE Island. Shows the first time a miner lands there,
 * closes with X at any step, and moves on by itself when the miner walks to a spot, picks spots
 * and deploys. Step 2 turns on the island's gold trail to the nearest spot (Snapshot.guide).
 */
import { useEffect, useRef, type ReactNode } from 'react';
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
  /** the arrow sits on the target's right, pointing left */
  flip?: boolean;
  title: string;
  body: string;
  target: TutTargetId | null;
  /** where the arrow aims along the target (0 = its left edge) */
  at?: number;
  /** which part of the target's width glows (one button of a row): starts at `from`, `span` wide */
  from?: number;
  span?: number;
  label?: string;
  waits?: string;
}
/** what moves a step on: SOL added, MAX pressed, SOL in the round, the round (or autopilot) over */
type Wait = 'amount' | 'amount01' | 'max' | 'clicked' | 'confirmed' | 'done';
const DESK_STEPS: (DeskStep & { wait?: Wait; clear?: boolean; approve?: boolean })[] = [
  { icon: 'ore', title: 'Mine ORE with LITE', body: 'Every round, about a minute, one of 25 spots strikes gold and mines ORE. LITE puts your SOL on all 25, so you are always on the gold spot. Three rounds to learn it: 0.01, then 0.1, then MAX.', target: null },
  { icon: 'grid', title: 'LITE is on', body: 'LITE covers every spot for you. Nothing to pick on the map. Each round uses 0.01 SOL.', target: 'tab-lite', at: 0.1, label: 'LITE' },
  // round 1: one round
  { icon: 'sol', title: 'Round 1: add 0.01', body: 'Click +0.01. That is one round. Only mine with SOL you can afford to lose.', target: 'quick', at: 0.04, span: 0.24, label: 'CLICK', waits: 'Moves on when you add SOL', wait: 'amount' },
  { icon: 'pick', title: 'Press DEPLOY', body: 'Your 0.01 SOL goes on ORE’s board for this round.', target: 'deploy', at: 0.04, label: 'CLICK', waits: 'Moves on when you press DEPLOY', wait: 'clicked' },
  { icon: 'wallet', title: 'Approve in your wallet', body: 'Your wallet asks you to approve the deploy. Check the amount and approve. Then wait a few seconds for the transaction to go through.', target: null, waits: 'Moves on when the transaction succeeds', wait: 'confirmed', approve: true },
  { icon: 'clock', title: 'Wait for the strike', body: 'When the clock runs out, ORE picks the gold spot. Most of your SOL comes back, plus the ORE you mined, into Unclaimed.', target: 'unclaimed', at: 0.04, waits: 'Moves on when the round ends', wait: 'done' },
  // round 2: 0.1 = 10 rounds on autopilot
  { icon: 'sol', title: 'Round 2: add 0.1', body: 'Click +0.1. That is 10 rounds of 0.01, mined one after another on autopilot.', target: 'quick', at: 0.27, from: 0.255, span: 0.24, label: 'CLICK', waits: 'Moves on when you add 0.1', wait: 'amount01', clear: true },
  { icon: 'bot', title: 'Press DEPLOY once', body: 'One wallet approval funds all 10 rounds. They deploy by themselves, one a minute. STOP gets the unused SOL back.', target: 'deploy', at: 0.04, label: 'CLICK', waits: 'Moves on when you press DEPLOY', wait: 'clicked' },
  { icon: 'wallet', title: 'Approve in your wallet', body: 'Your wallet asks you to approve the autopilot: one approval for all 10 rounds. Check the amount and approve. Then wait a few seconds for the transaction to go through.', target: null, waits: 'Moves on when the transaction succeeds', wait: 'confirmed', approve: true },
  { icon: 'clock', title: 'Autopilot is mining: take a walk', body: 'Your 10 rounds run on their own, about 10 minutes, wherever you are. Go explore: the lobby, the cave, the market, the arena. We will call you back for round 3.', target: null, waits: 'Moves on when autopilot finishes', wait: 'done' },
  // round 3: MAX
  { icon: 'sol', title: 'Round 3: MAX', body: 'Click MAX to put your SOL to work, as many 0.01 rounds as it covers (Gali keeps a little for fees, and autopilot has a cap).', target: 'quick', at: 0.765, from: 0.75, span: 0.25, label: 'CLICK', waits: 'Moves on when you press MAX', wait: 'max', clear: true },
  { icon: 'pick', title: 'Press DEPLOY', body: 'Your rounds mine on autopilot. Only mine with SOL you can afford to lose.', target: 'deploy', at: 0.04, label: 'CLICK', waits: 'Moves on when you press DEPLOY', wait: 'clicked' },
  { icon: 'wallet', title: 'Approve in your wallet', body: 'Your wallet asks you to approve the autopilot. Check the amount and approve. Then wait a few seconds for the transaction to go through.', target: null, waits: 'Moves on when the transaction succeeds', wait: 'confirmed', approve: true },
  { icon: 'gift', title: 'You are a miner now', body: 'Claim your SOL and ORE from Unclaimed any time. Want to pick your own spots? Try PRO.', target: 'unclaimed', at: 0.04 },
  // then: the quests
  { icon: 'quest', title: 'Now finish your quests', body: 'Daily quests give you XP every day. Reach Level 10 and Level 20 for certificate NFTs that claim a random Rare or Legendary weapon. Open Quests any time with Q.', target: 'tab-quests', at: 1, label: 'QUESTS', flip: true },
];
const QUEST_STEP = DESK_STEPS.length - 1;

/** the autopilot lesson's "take a walk" step */
const WALK_STEP = DESK_STEPS.findIndex((d) => d.icon === 'clock' && d.wait === 'done' && /walk/.test(d.title));

const PRO_TOUR: DeskStep[] = [
  { icon: 'grid', title: 'PRO: you pick the spots', body: 'Click spots on the map to choose them yourself, or set how many with − and +. ALL covers every spot.', target: 'pro-tiles', at: 0.04 },
  { icon: 'sol', title: 'SOL a round', body: 'This SOL is split evenly over your spots. Fewer spots: bigger share if one strikes, but you miss more rounds.', target: 'amount', at: 0.04 },
  { icon: 'pick', title: 'Deploy', body: 'Same as LITE: press DEPLOY, approve, wait for the strike. Back to LITE any time.', target: 'deploy', at: 0.04 },
];

function DeskCard({ s, step, total, onNext, onClose, tag, extra, low }: { s: DeskStep; step: number; total: number; onNext: () => void; onClose: () => void; tag: string; extra?: ReactNode; low?: boolean }) {
  const L = useLayout();
  useTutActive(true);
  return (
    <>
      <Pointer target={s.target} at={s.at} from={s.from} span={s.span} label={s.label} flip={s.flip} />
      <View pointerEvents="box-none" style={[styles.wrap, low ? { bottom: GUTTER + 96 } : { top: TOP_H + GUTTER * 2 + 8 }, { left: RAIL_W + GUTTER, right: L.side + GUTTER * 2 }]}>
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
              {s.flip ? "← Follow the arrow" : "Follow the arrow →"}
            </T>
          ) : null}
          {extra}
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
  const run = useGame((s) => s.run);
  const busy = useGame((s) => s.wallet.busy);
  // the deploy went through: this round's SOL is on the board, or the autopilot is funded
  const confirmed = useGame((s) => Boolean(s.pending || s.run?.automated));
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
        start(true, DESK_STEPS.length);
        useCoach.getState().finishIntro();
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [where, onboarded, deskDone, step, start, introBusy]);
  // each step's wait; a lesson that adds SOL starts from an empty box
  const maxAt = useTut((s) => s.maxAt);
  const enteredAt = useRef(0);
  useEffect(() => {
    if (!desk || step < 0) return;
    enteredAt.current = Date.now();
    if (DESK_STEPS[step]?.clear) useTut.setState({ clearAt: Date.now() });
  }, [desk, step]);
  useEffect(() => {
    if (!desk || step < 0) return;
    const w = DESK_STEPS[step]?.wait;
    if (!w) return;
    if ((w === 'amount' && amount > 0) || (w === 'amount01' && amount >= 0.1 - 1e-9) || (w === 'max' && maxAt > enteredAt.current) || (w === 'clicked' && (busy || inRound)) || (w === 'confirmed' && confirmed && !busy) || (w === 'done' && !inRound)) next();
    // the wallet said no (or the deploy failed): back to the DEPLOY step to try again
    else if (w === 'confirmed' && !busy && !inRound && Date.now() - enteredAt.current > 1500) useTutorial.setState({ step: step - 1 });
  }, [desk, step, amount, maxAt, inRound, busy, confirmed, next]);
  // PRO's own short tour, the first time a miner switches to PRO
  useEffect(() => {
    if (where === 'island' && tab === 'pro' && !pro.done && pro.step < 0 && step < 0) pro.start();
  }, [where, tab, pro, step]);

  // the autopilot lesson follows the miner off the island: progress while they walk, then a call back for round 3
  if (where !== 'island') {
    if (!desk || step < WALK_STEP || step >= DESK_STEPS.length) return null;
    const away: DeskStep =
      step === WALK_STEP
        ? { icon: 'clock', title: 'Autopilot is mining', body: `${run ? `${run.total - run.left} of ${run.total} rounds done. ` : ''}Keep exploring: the cave, the market, the arena and the games row are all in the lobby.`, target: null, waits: 'Moves on when autopilot finishes' }
        : { icon: 'sol', title: 'Autopilot finished: round 3', body: 'Your 10 rounds are done. Head back to ORE Island for the last lesson: MAX.', target: null };
    return (
      <DeskCard
        key={`a${step}`}
        s={away}
        step={step}
        total={DESK_STEPS.length}
        onNext={step === WALK_STEP ? next : () => useLobby.getState().go('island')}
        onClose={close}
        tag="LITE MINING"
        low
        extra={step > WALK_STEP ? <Btn kind="gold" label="BACK TO ORE ISLAND" onPress={() => useLobby.getState().go('island')} /> : null}
      />
    );
  }
  if (desk && step === WALK_STEP)
    return <DeskCard key={`l${step}`} s={DESK_STEPS[step]} step={step} total={DESK_STEPS.length} onNext={next} onClose={close} tag="LITE MINING" extra={<Btn kind="gold" label="TAKE A WALK: GO TO THE LOBBY" onPress={() => useLobby.getState().go('lobby')} />} />;
  if (desk && DESK_STEPS[step]?.approve)
    return (
      <DeskCard
        key={`l${step}`}
        s={DESK_STEPS[step]}
        step={step}
        total={DESK_STEPS.length}
        onNext={next}
        onClose={close}
        tag="LITE MINING"
        extra={
          <T v="label" style={{ color: busy ? COLORS.teal : COLORS.muted }}>
            {busy ? `Wallet: ${busy}` : confirmed ? 'Transaction went through' : 'Waiting for your wallet…'}
          </T>
        }
      />
    );
  if (desk && step === QUEST_STEP)
    return (
      <DeskCard
        key={`l${step}`}
        s={DESK_STEPS[step]}
        step={step}
        total={DESK_STEPS.length}
        onNext={next}
        onClose={close}
        tag="LITE MINING"
        extra={
          <Btn
            kind="gold"
            label="OPEN QUESTS"
            onPress={() => {
              next();
              useTut.setState({ questsAt: Date.now() });
            }}
          />
        }
      />
    );
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
