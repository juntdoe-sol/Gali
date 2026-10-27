/**
 * TV interface pieces: stepped-corner pixel panels, focusable buttons with gold corner brackets, the key-hint row,
 * the 5x5 board and animated miner sprites. No rounded corners, no blur, no glow.
 */
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View, findNodeHandle, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { C, F, U } from './theme';
import { SPRITES } from './spriteMap';
import qrcode from 'qrcode-generator';

/** Text in one of the three pixel fonts. */
export function T({ children, size = 24, color = C.text, font = 'body', style, numberOfLines }: {
  children: ReactNode;
  size?: number;
  color?: string;
  font?: keyof typeof F;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: F[font], fontSize: size, color, includeFontPadding: false }, style]}>
      {children}
    </Text>
  );
}

/** Small caps label (Silkscreen). */
export const Label = ({ children, color = C.dim, size = 16, style }: { children: ReactNode; color?: string; size?: number; style?: StyleProp<TextStyle> }) => (
  <T font="tiny" size={size} color={color} style={[{ letterSpacing: 2, textTransform: 'uppercase' }, style]}>
    {children}
  </T>
);

/**
 * A panel: dark edge, light bevel top and left, dark bevel bottom and right, and the four corners cut in two
 * steps so it never reads as rounded.
 */
export function Panel({ children, style, fill = C.panel, hi = C.bevelHi, lo = C.bevelLo, edge = C.edge, pad = 24 }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  hi?: string;
  lo?: string;
  edge?: string;
  pad?: number;
}) {
  return (
    <View style={[{ backgroundColor: edge }, style]}>
      {/* stepped corners: the edge colour shows through where the inner blocks stop short */}
      <View style={{ margin: U, flex: 1, backgroundColor: lo }}>
        <View style={{ margin: U, marginLeft: U, marginTop: U, flex: 1, backgroundColor: fill, borderTopWidth: U, borderLeftWidth: U, borderTopColor: hi, borderLeftColor: hi, padding: pad - 2 * U }}>
          {children}
        </View>
      </View>
      <View pointerEvents="none" style={[styles.notch, { top: 0, left: 0, backgroundColor: C.ocean }]} />
      <View pointerEvents="none" style={[styles.notch, { top: 0, right: 0, backgroundColor: C.ocean }]} />
      <View pointerEvents="none" style={[styles.notch, { bottom: 0, left: 0, backgroundColor: C.ocean }]} />
      <View pointerEvents="none" style={[styles.notch, { bottom: 0, right: 0, backgroundColor: C.ocean }]} />
    </View>
  );
}

/** Gold corner brackets, 8px thick and 32px long, that spring in when a control takes focus. */
function Brackets({ gap = 10 }: { gap?: number }) {
  const s = useRef(new Animated.Value(1.12)).current;
  useEffect(() => {
    Animated.spring(s, { toValue: 1, useNativeDriver: true, friction: 6, tension: 220 }).start();
  }, [s]);
  const arm = { position: 'absolute' as const, backgroundColor: C.gold };
  const L = 32;
  const W = 8;
  const o = -(gap + W);
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ scale: s }] }]}>
      <View style={[arm, { top: o, left: o, width: L, height: W }]} />
      <View style={[arm, { top: o, left: o, width: W, height: L }]} />
      <View style={[arm, { top: o, right: o, width: L, height: W }]} />
      <View style={[arm, { top: o, right: o, width: W, height: L }]} />
      <View style={[arm, { bottom: o, left: o, width: L, height: W }]} />
      <View style={[arm, { bottom: o, left: o, width: W, height: L }]} />
      <View style={[arm, { bottom: o, right: o, width: L, height: W }]} />
      <View style={[arm, { bottom: o, right: o, width: W, height: L }]} />
    </Animated.View>
  );
}

export type BtnTone = 'steel' | 'skr' | 'gold' | 'dark';
const TONES: Record<BtnTone, { fill: string; hi: string; lo: string; text: string }> = {
  steel: { fill: C.steel, hi: C.steelHi, lo: '#1b2f63', text: C.text },
  skr: { fill: C.skr, hi: '#e6ffb0', lo: C.skrDark, text: '#16300a' },
  gold: { fill: C.gold, hi: '#fff1a6', lo: C.goldDark, text: '#3a1800' },
  dark: { fill: '#0e1636', hi: C.bevelHi, lo: C.bevelLo, text: C.text },
};

/** A focusable button. The remote's OK press fires `onPress`; focus draws the gold brackets. */
export function Btn({ label, onPress, onFocus, tone = 'steel', style, size = 26, hasTVPreferredFocus, children, selected, focusGap, lockHorizontal }: {
  label?: string;
  onPress?: () => void;
  onFocus?: () => void;
  tone?: BtnTone;
  style?: StyleProp<ViewStyle>;
  size?: number;
  hasTVPreferredFocus?: boolean;
  children?: ReactNode;
  selected?: boolean;
  focusGap?: number;
  /** Keep Left/Right on this control (native focus stays put) so the app can use them to change a value. */
  lockHorizontal?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  const [tag, setTag] = useState<number | undefined>();
  const t = TONES[tone];
  return (
    <Pressable
      ref={ref}
      focusable
      hasTVPreferredFocus={hasTVPreferredFocus}
      onLayout={() => lockHorizontal && setTag(findNodeHandle(ref.current) ?? undefined)}
      nextFocusLeft={lockHorizontal ? tag : undefined}
      nextFocusRight={lockHorizontal ? tag : undefined}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={[{ overflow: 'visible' }, style]}
    >
      <View style={{ flex: 1, backgroundColor: C.edge, padding: U }}>
        <View
          style={{
            flex: 1,
            backgroundColor: t.fill,
            borderTopWidth: U,
            borderLeftWidth: U,
            borderBottomWidth: U,
            borderRightWidth: U,
            borderTopColor: t.hi,
            borderLeftColor: t.hi,
            borderBottomColor: t.lo,
            borderRightColor: t.lo,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            opacity: selected === false ? 0.7 : 1,
          }}
        >
          {children ?? (
            <T font="display" size={size} color={t.text} style={{ letterSpacing: 2 }}>
              {label}
            </T>
          )}
        </View>
      </View>
      {focused && <Brackets gap={focusGap} />}
    </Pressable>
  );
}

/** The bottom key-hint row: [key] what it does. */
export function KeyHints({ hints }: { hints: { key: string; text: string; hot?: boolean }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 28, alignItems: 'center' }}>
      {hints.map((h) => (
        <View key={h.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ backgroundColor: h.hot ? C.skr : '#1a2552', paddingHorizontal: 12, paddingVertical: 4, borderBottomWidth: U, borderBottomColor: h.hot ? C.skrDark : C.bevelHi }}>
            <T font="tiny" size={15} color={h.hot ? '#16300a' : C.dim} style={{ letterSpacing: 2 }}>
              {h.key}
            </T>
          </View>
          <T font="tiny" size={15} color={C.dim} style={{ letterSpacing: 2 }}>
            {h.text}
          </T>
        </View>
      ))}
    </View>
  );
}

/** A sprite from the pre-scaled set (nearest-neighbour, so the pixels stay square). */
export function Sprite({ name, style }: { name: string; style?: StyleProp<ViewStyle> }) {
  const src = SPRITES[name];
  const dim = typeof src === 'number' ? Image.resolveAssetSource(src) : null;
  return <Image source={src} fadeDuration={0} style={[dim ? { width: dim.width, height: dim.height } : null, style as never]} />;
}

const POSES: Record<string, { n: number; ms: number }> = { swing: { n: 6, ms: 90 }, cheer: { n: 4, ms: 120 }, idle: { n: 4, ms: 180 } };

/** One frame clock for every miner on screen, so three miners cost one timer. */
export function useFrame(pose: keyof typeof POSES, offset = 0): number {
  const { n, ms } = POSES[pose];
  const [f, setF] = useState(offset % n);
  useEffect(() => {
    const id = setInterval(() => setF((x) => (x + 1) % n), ms);
    return () => clearInterval(id);
  }, [n, ms]);
  return f;
}

/** A miner playing one pose on a loop. `look` picks one of the three composed miners (a, b, c). */
export const Miner = memo(function Miner({ look = 'a', pose = 'swing', offset = 0, style }: { look?: 'a' | 'b' | 'c'; pose?: 'swing' | 'cheer' | 'idle'; offset?: number; style?: StyleProp<ViewStyle> }) {
  const f = useFrame(pose, offset);
  return <Sprite name={`miner-${look}-${pose}-${f}`} style={style} />;
});

/** The 5x5 board. `cells` colours a spot; a gold cell is the winner or a covered spot. */
export const Board = memo(function Board({ cells, size = 70, gap = 6, labels = true }: { cells: ('empty' | 'covered' | 'hot' | 'win')[]; size?: number; gap?: number; labels?: boolean }) {
  return (
    <View style={{ gap }}>
      {[0, 1, 2, 3, 4].map((r) => (
        <View key={r} style={{ flexDirection: 'row', gap }}>
          {[0, 1, 2, 3, 4].map((c) => {
            const i = r * 5 + c;
            const k = cells[i] ?? 'empty';
            const win = k === 'win';
            return (
              <View
                key={i}
                style={{
                  width: size,
                  height: size,
                  backgroundColor: win ? C.gold : k === 'hot' ? '#2d6a2b' : C.well,
                  borderWidth: 3,
                  borderColor: win ? '#fff1a6' : k === 'empty' ? '#1e2c5c' : C.skrDark,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {labels && (
                  <T font="display" size={size * 0.36} color={win ? '#3a1800' : k === 'empty' ? C.dim : '#c6d4ff'}>
                    {i + 1}
                  </T>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
});

/** The segmented progress bar from the Mining screen. */
export function Segments({ value, count = 20, h = 34 }: { value: number; count?: number; h?: number }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * count);
  return (
    <View style={{ flexDirection: 'row', gap: 6, backgroundColor: C.well, padding: 6, borderWidth: 3, borderColor: '#1e2c5c' }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={{ flex: 1, height: h, backgroundColor: i < on ? C.skr : '#101a40', borderTopWidth: 3, borderTopColor: i < on ? '#e6ffb0' : '#17234f' }} />
      ))}
    </View>
  );
}

/**
 * A QR code drawn as pixel blocks (square modules, no smoothing), on a white card with a 4-module quiet zone.
 * Each row's dark runs are one View, so a typical link is a few hundred views rather than thousands.
 */
export const Qr = memo(function Qr({ value, size = 520 }: { value: string; size?: number }) {
  const rows = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value);
    q.make();
    const n = q.getModuleCount();
    const out: { y: number; runs: [number, number][] }[] = [];
    for (let y = 0; y < n; y++) {
      const runs: [number, number][] = [];
      let x = 0;
      while (x < n) {
        if (!q.isDark(y, x)) {
          x++;
          continue;
        }
        const start = x;
        while (x < n && q.isDark(y, x)) x++;
        runs.push([start, x - start]);
      }
      out.push({ y, runs });
    }
    return { n, out };
  }, [value]);
  const quiet = 4;
  const cell = Math.floor(size / (rows.n + quiet * 2));
  const side = cell * (rows.n + quiet * 2);
  return (
    <View style={{ width: side, height: side, backgroundColor: '#f4f6ff' }}>
      {rows.out.map(({ y, runs }) =>
        runs.map(([x, w]) => (
          <View key={`${y}-${x}`} style={{ position: 'absolute', left: (x + quiet) * cell, top: (y + quiet) * cell, width: w * cell, height: cell, backgroundColor: '#060a1c' }} />
        )),
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  notch: { position: 'absolute', width: U, height: U },
});
