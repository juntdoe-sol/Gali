/**
 * The first-time coach's cards (computer, in the lobby): walk, jump, swing, ride, then off to mine; and a
 * card for each place the first time you walk up to it. See game/coach.ts.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { INTRO, useCoach, type PlaceId } from '../game/coach';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { useGame } from '../game/store';
import { useName } from '../game/username';
import { useTutorial } from '../game/tutorial';
import { Btn, IconBtn, Kbd, PixelBox, T, U } from './kit';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, useLayout } from './layout';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

interface Card {
  icon: PixName;
  title: string;
  body: string;
  keys?: string[];
  waits?: string;
}
const INTRO_CARDS: Record<(typeof INTRO)[number], Card> = {
  walk: { icon: 'star', title: 'Walk around', body: 'Walk with W A S D or the arrow keys. You can also click the ground to walk there.', keys: ['W', 'A', 'S', 'D'], waits: 'Moves on when you walk a few steps' },
  jump: { icon: 'jump', title: 'Jump', body: 'Press SPACE to jump. It also dodges a hit.', keys: ['SPC'], waits: 'Moves on when you jump' },
  swing: { icon: 'fist', title: 'Swing your pickaxe', body: 'Press F or left click to swing. Smash pots, crates and bushes for HP, and crack dark ore veins for XP.', keys: ['F', 'LMB'], waits: 'Moves on when you swing' },
  ride: { icon: 'cart', title: 'Ride a cart or scooter', body: 'Carts and scooters stand all over the lobby. Walk up to one and press E. Press E again to get off.', keys: ['E'], waits: 'Moves on when you ride' },
  mine: { icon: 'ore', title: 'Now mine ORE', body: 'ORE Island is where the mining happens. Walk east to the pier, or go there now: a short LITE tutorial is waiting.' },
};
const PLACE_CARDS: Record<PlaceId, Card> = {
  cave: { icon: 'pick', title: 'Cave Run', body: 'Dig down, dodge the falling rocks and earn XP. It never spends SOL. Walk in to start.' },
  market: { icon: 'bag', title: 'Gear Market', body: 'The vending machine sells gear for your miner: helmets, clothes, shoes, axes and pets. Step up to it to browse.' },
  arena: { icon: 'trophy', title: 'Gali Fightclub', body: 'Knock miners out of the ring: 3 lives each, the higher their %, the further they fly. Fill your meter and fire your special. Online matches move your Fightclub rank.' },
  games: { icon: 'cart', title: 'Mini games', body: 'Tunnel Collapse, Gold Rush Pot and Crash Cart. Stake ORE or SKR, a new round every 40 seconds, 5% house fee. 18+ only: stake only what you can afford to lose.' },
};

/** Key caps that dip one after another, so the eye goes to them. */
function Keys({ keys }: { keys: string[] }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 320);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={styles.keys}>
      {keys.map((k, i) => (
        <View key={k} style={{ transform: [{ translateY: t % keys.length === i ? U * 2 : 0 }, { scale: 1.6 }] }}>
          <Kbd k={k} />
        </View>
      ))}
    </View>
  );
}

function CoachCard({ c, step, total, tag, onNext, onClose, nextLabel, extra }: { c: Card; step?: number; total?: number; tag: string; onNext: () => void; onClose: () => void; nextLabel: string; extra?: ReactNode }) {
  const L = useLayout();
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: TOP_H + GUTTER * 2 + 8, left: RAIL_W + GUTTER, right: L.side + GUTTER * 2 }]}>
      <PixelBox fill="rgba(8,13,32,0.96)" hi={COLORS.gold} lo="#04060f" shadow={1} style={styles.card}>
        <View style={styles.head}>
          <PixIcon name={c.icon} size={30} />
          <View style={{ flex: 1 }}>
            <T v="label" style={{ color: COLORS.teal }}>
              {tag}
              {step !== undefined && total ? ` · ${step + 1}/${total}` : ''}
            </T>
            <T v="display" style={{ fontSize: 22, lineHeight: 23, color: COLORS.gold }}>
              {c.title}
            </T>
          </View>
          <IconBtn onPress={onClose} label="Skip the tutorial">
            <PixIcon name="close" size={16} />
          </IconBtn>
        </View>
        {c.keys ? <Keys keys={c.keys} /> : null}
        <T v="body" style={{ fontSize: 14, lineHeight: 19 }}>
          {c.body}
        </T>
        {extra}
        <View style={styles.foot}>
          {step !== undefined && total ? (
            <View style={styles.dots}>
              {Array.from({ length: total }, (_, k) => (
                <View key={k} style={[styles.dot, { backgroundColor: k <= step ? COLORS.gold : '#22356f' }]} />
              ))}
            </View>
          ) : (
            <View />
          )}
          {c.waits ? (
            <T v="muted" style={{ fontSize: 12, flexShrink: 1, textAlign: 'right' }}>
              {c.waits}
            </T>
          ) : null}
          <Btn small kind={c.waits ? 'ghost' : 'gold'} label={nextLabel} onPress={onNext} />
        </View>
      </PixelBox>
    </View>
  );
}

export function Coach() {
  const L = useLayout();
  const where = useLobby((s) => s.where);
  const onboarded = useGame((s) => s.save.onboarded);
  const name = useName((s) => s.name);
  const { introDone, introStep, place, nextIntro, finishIntro, closePlace } = useCoach();
  const desk = L.desktop && !LANDSCAPE_APP;

  // first time in the lobby with a name: start the intro
  useEffect(() => {
    if (!desk || where !== 'lobby' || !onboarded || !name || introDone || introStep >= 0) return;
    const t = setTimeout(() => useCoach.getState().startIntro(), 1500);
    return () => clearTimeout(t);
  }, [desk, where, onboarded, name, introDone, introStep]);

  if (!desk || where !== 'lobby') return null;
  if (introStep >= 0) {
    const id = INTRO[introStep];
    const c = INTRO_CARDS[id];
    const skipAll = () => {
      finishIntro();
      // skipping the intro skips the island's LITE tutorial too
      useTutorial.setState({ deskDone: true });
    };
    return (
      <CoachCard
        key={id}
        c={c}
        step={introStep}
        total={INTRO.length}
        tag="FIRST STEPS"
        onNext={nextIntro}
        onClose={skipAll}
        nextLabel={id === 'mine' ? 'Later' : c.waits ? 'Skip step' : 'Next'}
        extra={id === 'mine' ? <Btn kind="gold" label="TAKE ME TO ORE ISLAND" onPress={() => useLobby.getState().go('island')} /> : null}
      />
    );
  }
  if (place) return <CoachCard key={place} c={PLACE_CARDS[place]} tag="NEW PLACE" onNext={closePlace} onClose={closePlace} nextLabel="Got it" />;
  return null;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignItems: 'center', zIndex: 30 },
  card: { width: '100%', maxWidth: 460, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  keys: { flexDirection: 'row', gap: 22, justifyContent: 'center', paddingVertical: 10 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 8, height: 8 },
});
