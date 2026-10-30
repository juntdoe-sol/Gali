/**
 * A one-line coach mark over the map, for the first few seconds of a visit:
 * how to pick a spot. It goes as soon as you do
 * either, and doesn't come back until the next visit.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { useView } from '../pixel/view';
import { useTutorial } from '../game/tutorial';
import { PixelBox, T } from './kit';
import { PixIcon } from './PixIcon';
import { LANDSCAPE_APP, useLayout } from './layout';
import { BAR_H } from './TabBar';

export function MapHint() {
  const onboarded = useGame((s) => s.save.onboarded);
  const tut = useTutorial((s) => s.step);
  const focus = useView((s) => s.focus);
  const picked = useGame((s) => s.selected.length);
  const dockOpen = useGame((s) => s.dockOpen);
  const insets = useSafeAreaInsets();
  const { desktop, mouse, side } = useLayout();
  const [done, setDone] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;
  const startPicked = useRef(picked);

  useEffect(() => {
    if (focus >= 0 || picked !== startPicked.current) setDone(true);
  }, [focus, picked]);
  useEffect(() => {
    if (!onboarded || done) return;
    Animated.timing(fade, { toValue: 1, duration: 300, delay: 1200, useNativeDriver: true }).start();
    const t = setTimeout(() => setDone(true), 14000);
    return () => clearTimeout(t);
  }, [onboarded, done, fade]);
  useEffect(() => {
    if (done) Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start();
  }, [done, fade]);

  // the landscape app has no room under the map: the DEPLOY panel says the same thing
  if (!onboarded || (dockOpen && !desktop) || LANDSCAPE_APP || tut >= 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, desktop ? { bottom: 130, left: 88, right: side + 28 } : { bottom: BAR_H + insets.bottom + 18 }, { opacity: fade }]}>
      <PixelBox fill="rgba(8,13,32,0.92)" hi={COLORS.teal} lo="#04060f" shadow={1} style={styles.pill}>
        <PixIcon name="star" size={16} />
        <T v="display" style={styles.text}>
          {mouse ? 'CLICK A SPOT TO PICK IT' : 'TAP A SPOT TO PICK IT'}
        </T>
      </PixelBox>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 6 },
  text: { color: COLORS.text, fontSize: 17, letterSpacing: 1 },
});
