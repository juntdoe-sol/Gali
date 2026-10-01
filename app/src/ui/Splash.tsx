/**
 * The first thing on screen: the Gali mark, the name in pixel blocks and a bar
 * that fills as the island and the fonts arrive. The mark is a 13 KB image
 * bundled with the app; the rest is plain Views. Then it lifts away.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import { useView } from '../pixel/view';

const GLYPHS: Record<string, string[]> = {
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
};
const PX = 9;

function Word({ word }: { word: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: PX }}>
      {word.split('').map((ch, k) => (
        <View key={k}>
          {GLYPHS[ch].map((row, y) => (
            <View key={y} style={{ flexDirection: 'row' }}>
              {row.split('').map((v, x) => (
                <View key={x} style={{ width: PX, height: PX, backgroundColor: v === '#' ? (y < 2 ? '#ffe7a3' : '#ffcf4a') : 'transparent', borderBottomWidth: v === '#' && y === 4 ? 2 : 0, borderColor: '#e08a1e' }} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function Splash({ fontsLoaded }: { fontsLoaded: boolean }) {
  const ready = useView((s) => s.ready);
  const fade = useRef(new Animated.Value(1)).current;
  const fill = useRef(new Animated.Value(0.15)).current;
  const [gone, setGone] = useState(false);
  const done = ready && fontsLoaded;

  useEffect(() => {
    const k = (ready ? 0.5 : 0) + (fontsLoaded ? 0.4 : 0) + 0.1;
    Animated.timing(fill, { toValue: k, duration: 260, useNativeDriver: false }).start();
    if (done) Animated.timing(fade, { toValue: 0, duration: 420, delay: 220, useNativeDriver: true }).start(() => setGone(true));
  }, [ready, fontsLoaded, done, fade, fill]);

  if (gone) return null;
  return (
    <Animated.View pointerEvents={done ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}>
      <Image source={require('../../assets/brand/logo.png')} style={styles.logo} accessibilityLabel="Gali" />
      <Word word="GALI" />
      <View style={styles.track}>
        <Animated.View style={[styles.bar, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#070d20', alignItems: 'center', justifyContent: 'center', gap: 22 },
  logo: { width: 168, height: 168 },
  track: { width: 180, height: 10, borderWidth: 2, borderColor: '#2a4480', backgroundColor: '#0c1734' },
  bar: { height: '100%', backgroundColor: '#ffcf4a' },
});
