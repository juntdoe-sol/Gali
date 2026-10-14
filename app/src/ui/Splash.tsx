/**
 * The first thing on screen: the Gali mark, the name in pixel blocks and a bar
 * that fills as the island and the fonts arrive. The mark is a 13 KB image
 * bundled with the app; the rest is plain Views. Then it lifts away.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
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
      <Text style={styles.tag}>THE ORE MINING GAME</Text>
      <View style={styles.track}>
        <View style={styles.trackV} />
        <View style={styles.trackIn}>
          <Animated.View style={[styles.bar, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}>
            <View style={styles.barHi} />
            <View style={styles.barLo} />
          </Animated.View>
        </View>
      </View>
      <Text style={styles.hint}>{ready ? 'LOADING THE INTERFACE' : 'LOADING THE ISLAND'}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: '#070d20', alignItems: 'center', justifyContent: 'center', gap: 22 },
  logo: { width: 168, height: 168 },
  tag: { color: '#ffcf4a', fontFamily: 'Jersey15_400Regular', fontSize: 20, letterSpacing: 3, marginTop: -8 },
  hint: { color: '#8ea2cc', fontFamily: 'Jersey15_400Regular', fontSize: 15, letterSpacing: 2, marginTop: -12 },
  // the same notched pixel bar as the boot screen in public/index.html
  track: { width: 180, height: 12, paddingHorizontal: 2, backgroundColor: 'transparent' },
  trackV: { position: 'absolute', left: 2, right: 2, top: 0, bottom: 0, backgroundColor: '#04060f' },
  trackIn: { position: 'absolute', left: 0, right: 0, top: 2, bottom: 2, backgroundColor: '#04060f', paddingHorizontal: 2 },
  bar: { height: '100%', backgroundColor: '#ffc93c', overflow: 'hidden' },
  barHi: { position: 'absolute', left: 0, right: 0, top: 0, height: 2, backgroundColor: '#fff1a6' },
  barLo: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: '#d27a12' },
});
