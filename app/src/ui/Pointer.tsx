/**
 * The tutorial's pointing arrow: a chunky pixel arrow that bobs toward a real button, and a glow round it.
 * The button reports where it is through useTutTarget (game/tutTargets.ts).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useTut, type TutTargetId } from '../game/tutTargets';
import { T } from './kit';

// pointing right; '#' gold, 'o' dark outline
const ARROW = [
  '.......oo.....',
  '.......o#o....',
  'oooooooo##o...',
  'o##########o..',
  'o###########o.',
  'o##########o..',
  'oooooooo##o...',
  '.......o#o....',
  '.......oo.....',
];
const P = 3; // screen px per arrow pixel
const AW = ARROW[0].length * P;
const AH = ARROW.length * P;

/** Turns on target measuring while mounted. */
export function useTutActive(on: boolean) {
  useEffect(() => {
    useTut.setState({ active: on });
    return () => useTut.setState({ active: false });
  }, [on]);
}

/**
 * Points at `target`; `at` is where along its width the arrow aims (0 left edge .. 1 right edge). `flip` puts the
 * arrow on the target's right, pointing left (for things at the screen's left edge, like the rail).
 */
export function Pointer({ target, at = 0, from = 0, span = 1, label, flip }: { target: TutTargetId | null; at?: number; from?: number; span?: number; label?: string; flip?: boolean }) {
  const rect = useTut((s) => (target ? s.rects[target] : undefined));
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 160);
    return () => clearInterval(id);
  }, []);
  if (!target || !rect) return null;
  const bob = [0, 3, 6, 3][t % 4];
  const ax = rect.x + rect.w * at;
  const left = flip ? ax + 6 + bob : ax - AW - 6 - bob;
  const top = rect.y + rect.h / 2 - AH / 2;
  const glow = t % 2 ? '#fff1a8' : COLORS.gold;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
      <View style={[styles.glow, { left: rect.x + rect.w * from - 4, top: rect.y - 4, width: rect.w * span + 8, height: rect.h + 8, borderColor: glow }]} />
      <View style={{ position: 'absolute', left, top, width: AW, height: AH }}>
        {ARROW.flatMap((row, r) =>
          [...row].map((ch, c) =>
            ch === '.' ? null : <View key={`${r}-${c}`} style={{ position: 'absolute', left: (flip ? row.length - 1 - c : c) * P, top: r * P, width: P, height: P, backgroundColor: ch === '#' ? glow : '#1a0f00' }} />,
          ),
        )}
      </View>
      {label ? (
        <View style={[styles.tag, { left: left - 4, top: top + AH + 2 }]}>
          <View style={styles.tagIn}>
            <TagText text={label} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TagText({ text }: { text: string }) {
  return (
    <T v="display" style={{ fontSize: 13, lineHeight: 14, color: '#2a1400' }}>
      {text}
    </T>
  );
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', borderWidth: 3 },
  tag: { position: 'absolute' },
  tagIn: { backgroundColor: COLORS.gold, paddingHorizontal: 5, paddingVertical: 2 },
});
