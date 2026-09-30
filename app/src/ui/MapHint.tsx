/**
 * A one-line coach mark over the map, for the first few seconds of a visit:
 * how to look inside a claim and how to pick one. It goes as soon as you do
 * either, and doesn't come back until the next visit.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { COLORS } from '../game/constants';
import { useGame } from '../game/store';
import { fx } from '../pixel/fx';
import { useView } from '../pixel/view';
import { T } from './kit';

export function MapHint() {
  const onboarded = useGame((s) => s.save.onboarded);
  const focus = useView((s) => s.focus);
  const picked = useGame((s) => s.selected.length);
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

  if (!onboarded) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.pill, { bottom: fx.viewBottom + 6, opacity: fade }]}>
      <T v="bold" style={styles.text}>
        Tap a spot to look inside · hold to pick it
      </T>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: '#070d20e6',
    borderColor: COLORS.teal,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  text: { color: COLORS.text, fontSize: 12 },
});
