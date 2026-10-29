/**
 * Gali's "terminal" layer: the parts the Gear Market and the BAG loadout are built from.
 *
 * Same rules as the pixel kit (flat blocks, whole 2px units, no blur, no rounded corners), pushed toward a holo
 * console: HUD corner brackets, LED lights, segmented meters, a scanline that sweeps, and a holo stage with a
 * pixel perspective floor, a light column and a pedestal whose rim lights chase round. Colours come from the
 * season palette (COLORS.teal is cyan, or ghost green in Hollow Night).
 */
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { IS_HOLLOW } from '../game/season';
import { haptic, play } from '../game/sfx';
import { F, FocusRing, T, U } from './kit';

const isWeb = Platform.OS === 'web';

export const TECH = {
  ink: IS_HOLLOW ? '#07040f' : '#03060f',
  deep: IS_HOLLOW ? 'rgba(10,5,20,0.95)' : 'rgba(4,8,20,0.95)',
  panel: IS_HOLLOW ? 'rgba(16,8,30,0.92)' : 'rgba(7,12,30,0.92)',
  raise: IS_HOLLOW ? '#1a0e2c' : '#0c1530',
  rule: IS_HOLLOW ? 'rgba(190,150,255,0.16)' : 'rgba(120,160,240,0.16)',
  dim: IS_HOLLOW ? '#7d6aa6' : '#6f84b8',
};

/** A hex colour at some opacity. */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A counter that steps every `ms` while `on`: drives the stepped (pixel-honest) animations. */
export function useTick(ms: number, on = true): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((x) => (x + 1) % 1_000_000), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return n;
}

/** Four HUD corner brackets around whatever box it sits in. */
export function Corners({ color, size = 10, w = U, inset = 0 }: { color: string; size?: number; w?: number; inset?: number }) {
  const b = { position: 'absolute' as const, backgroundColor: color };
  const i = inset;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[b, { left: i, top: i, width: size, height: w }]} />
      <View style={[b, { left: i, top: i, width: w, height: size }]} />
      <View style={[b, { right: i, top: i, width: size, height: w }]} />
      <View style={[b, { right: i, top: i, width: w, height: size }]} />
      <View style={[b, { left: i, bottom: i, width: size, height: w }]} />
      <View style={[b, { left: i, bottom: i, width: w, height: size }]} />
      <View style={[b, { right: i, bottom: i, width: size, height: w }]} />
      <View style={[b, { right: i, bottom: i, width: w, height: size }]} />
    </View>
  );
}

/** A square status light with a one-unit halo. `blink` makes it pulse. */
export function Led({ color, on = true, blink = false, size = 6 }: { color: string; on?: boolean; blink?: boolean; size?: number }) {
  const t = useTick(520, blink && on);
  const lit = on && (!blink || t % 2 === 0);
  return (
    <View style={{ width: size + U * 2, height: size + U * 2, alignItems: 'center', justifyContent: 'center', backgroundColor: lit ? alpha(color, 0.25) : 'transparent' }}>
      <View style={{ width: size, height: size, backgroundColor: lit ? color : alpha(color, 0.22) }} />
    </View>
  );
}

/** A segmented meter: `n` of `of` cells lit. */
export function Meter({ n, of, color, cell = 10, h = 6, gap = U }: { n: number; of: number; color: string; cell?: number; h?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={{ width: cell, height: h, backgroundColor: i < n ? color : alpha(color, 0.14) }} />
      ))}
    </View>
  );
}

/** A label and value on one line, like a console readout. */
export function Readout({ k, v, color, children }: { k: string; v?: string; color?: string; children?: ReactNode }) {
  return (
    <View style={styles.readout}>
      <T v="tiny" style={styles.readK}>
        {k}
      </T>
      <View style={styles.readDots} />
      {children ?? (
        <T v="display" numberOfLines={1} style={{ fontSize: 17, lineHeight: 18, color: color ?? COLORS.text, letterSpacing: 0.6 }}>
          {v}
        </T>
      )}
    </View>
  );
}

/** A thin bright band that sweeps down the box, over and over. */
export function Scanline({ color, height, period = 2600 }: { color: string; height: number; period?: number }) {
  const y = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(y, { toValue: 1, duration: period, easing: Easing.linear, useNativeDriver: !isWeb }));
    loop.start();
    return () => loop.stop();
  }, [y, period]);
  const ty = y.interpolate({ inputRange: [0, 1], outputRange: [-12, height] });
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 12, transform: [{ translateY: ty }] }}>
      <View style={{ height: U, backgroundColor: alpha(color, 0.05) }} />
      <View style={{ height: U * 2, backgroundColor: alpha(color, 0.1) }} />
      <View style={{ height: U, backgroundColor: alpha(color, 0.32) }} />
      <View style={{ height: U * 2, backgroundColor: alpha(color, 0.08) }} />
    </Animated.View>
  );
}

/** Rows of a pixel ellipse: [y offset, half width] in units of `u`, top to bottom. */
function ellipseRows(rx: number, ry: number, u: number): [number, number][] {
  const out: [number, number][] = [];
  const n = Math.max(1, Math.round(ry / u));
  for (let i = -n; i <= n; i++) {
    const t = i / n;
    const hw = Math.round((rx * Math.sqrt(Math.max(0, 1 - t * t))) / u) * u;
    out.push([i * u, hw]);
  }
  return out;
}

/** The back wall and the floor: a dot grid, then a pixel perspective floor that fans out from a vanishing point. */
const Backdrop = memo(function Backdrop({ width, height, horizon, color }: { width: number; height: number; horizon: number; color: string }) {
  const dots = useMemo(() => {
    const out: { x: number; y: number }[] = [];
    const step = 20;
    for (let y = 14; y < horizon - 6; y += step) for (let x = (width % step) / 2; x < width; x += step) out.push({ x, y });
    return out;
  }, [width, horizon]);
  const floor = useMemo(() => {
    const cells: { x: number; y: number; a: number; w: number; h: number }[] = [];
    const fh = height - horizon;
    if (fh < 8) return cells;
    const cx = width / 2;
    // fan lines: from a vanishing point above the horizon to evenly spaced points past the bottom edge
    const vy = horizon - fh * 0.9;
    const span = width * 1.5;
    const lines = 13;
    for (let l = 0; l < lines; l++) {
      const bx = cx - span / 2 + (span * l) / (lines - 1);
      for (let y = horizon; y < height; y += 4) {
        const k = (y - vy) / (height - vy);
        const x = Math.round((cx + (bx - cx) * k) / U) * U;
        if (x < 0 || x >= width) continue;
        const t = (y - horizon) / fh;
        cells.push({ x, y, a: 0.05 + 0.3 * t, w: U, h: 4 });
      }
    }
    // cross lines: closer together toward the horizon
    for (let k = 1; k <= 7; k++) {
      const t = (k / 7) ** 2;
      const y = Math.round((horizon + fh * t) / U) * U;
      cells.push({ x: 0, y, a: 0.06 + 0.26 * t, w: width, h: U });
    }
    return cells;
  }, [width, height, horizon]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* the room gets lighter toward the floor in three hard steps */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon * 0.45, height: horizon * 0.55, backgroundColor: alpha(color, 0.025) }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon * 0.75, height: horizon * 0.25, backgroundColor: alpha(color, 0.03) }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon, bottom: 0, backgroundColor: alpha(color, 0.04) }} />
      {dots.map((d, i) => (
        <View key={`d${i}`} style={{ position: 'absolute', left: d.x, top: d.y, width: U, height: U, backgroundColor: alpha(color, 0.13) }} />
      ))}
      <View style={{ position: 'absolute', left: 0, right: 0, top: horizon, height: U, backgroundColor: alpha(color, 0.35) }} />
      {floor.map((c, i) => (
        <View key={`f${i}`} style={{ position: 'absolute', left: c.x, top: c.y, width: c.w, height: c.h, backgroundColor: alpha(color, c.a) }} />
      ))}
    </View>
  );
});

/**
 * The holo stage: room, floor, a light column over a pedestal, sparks rising in the light, a sweeping scanline and
 * HUD corners. `feet` is the y of the pedestal's top, where whatever stands on it should put its feet.
 */
export function HoloStage({
  width,
  height,
  color,
  children,
  pedestal = 0.5,
  live = true,
  style,
}: {
  width: number;
  height: number;
  color: string;
  children?: ReactNode;
  /** pedestal width as a share of the stage width (capped) */
  pedestal?: number;
  live?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const tick = useTick(110, live);
  const geo = stageGeo(width, height, pedestal);
  const { cx, feet, rx, ry, horizon } = geo;
  const top = ellipseRows(rx, ry, U);
  const rim = useMemo(() => {
    // the outline of the top face, as cells going round, so a light can chase along it
    const cells: [number, number][] = [];
    const rows = ellipseRows(rx, ry, U);
    rows.forEach(([dy, hw]) => cells.push([cx + hw - U, feet + dy]));
    [...rows].reverse().forEach(([dy, hw]) => cells.push([cx - hw, feet + dy]));
    return cells;
  }, [cx, feet, rx, ry]);
  const chase = tick % Math.max(1, rim.length);
  const pulse = tick % 12 < 6;
  const sparks = [0.18, 0.33, 0.5, 0.64, 0.8, 0.42].map((p, i) => {
    const colH = feet - 10;
    const y = feet - ((tick * (2 + (i % 3)) + i * 37) % colH);
    return { x: cx + (p - 0.5) * rx * 1.4, y, s: i % 2 ? U : U * 2 };
  });
  return (
    <View style={[{ width, height, backgroundColor: TECH.ink, overflow: 'hidden' }, style]}>
      <Backdrop width={width} height={height} horizon={horizon} color={color} />
      {/* the light column */}
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx, width: rx * 2, top: 0, height: feet, backgroundColor: alpha(color, pulse ? 0.05 : 0.035) }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx * 0.7, width: rx * 1.4, top: 0, height: feet, backgroundColor: alpha(color, 0.05) }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx * 0.36, width: rx * 0.72, top: 0, height: feet, backgroundColor: alpha(color, pulse ? 0.07 : 0.05) }} />
      {sparks.map((s, i) => (
        <View key={`s${i}`} pointerEvents="none" style={{ position: 'absolute', left: Math.round(s.x / U) * U, top: Math.round(s.y / U) * U, width: s.s, height: s.s, backgroundColor: alpha(color, 0.6) }} />
      ))}
      {/* pedestal: the side band, then the top face, then the lit rim */}
      {top.map(([dy, hw], i) =>
        dy >= 0 ? <View key={`b${i}`} pointerEvents="none" style={{ position: 'absolute', left: cx - hw, top: feet + dy, width: hw * 2, height: ry * 0.9 + U, backgroundColor: '#05070d' }} /> : null,
      )}
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx, top: feet, width: rx * 2, height: ry * 0.9 + U, backgroundColor: TECH.raise }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx, top: feet + ry * 0.9, width: rx * 2, height: U, backgroundColor: alpha(color, 0.5) }} />
      {top.map(([dy, hw], i) => (
        <View key={`t${i}`} pointerEvents="none" style={{ position: 'absolute', left: cx - hw, top: feet + dy, width: hw * 2, height: U, backgroundColor: i < top.length / 2 ? '#1b2440' : '#141b33' }} />
      ))}
      {rim.map(([x, y], i) => {
        const d = (chase - i + rim.length) % rim.length;
        const a = d === 0 ? 1 : d < 4 ? 0.7 - d * 0.15 : 0.28;
        return <View key={`r${i}`} pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: U, height: U, backgroundColor: alpha(color, a) }} />;
      })}
      {/* the shadow of whatever stands there */}
      <View pointerEvents="none" style={{ position: 'absolute', left: cx - rx * 0.42, top: feet - U, width: rx * 0.84, height: U * 2, backgroundColor: 'rgba(0,0,0,0.45)' }} />
      {children}
      {live ? <Scanline color={color} height={height} /> : null}
      <Corners color={alpha(color, 0.85)} size={14} inset={6} />
    </View>
  );
}

/** Where the HoloStage puts its pedestal, so a caller can stand things on it. */
export function stageGeo(width: number, height: number, pedestal = 0.5) {
  const cx = Math.round(width / 2 / U) * U;
  const rx = Math.round(Math.min(width * pedestal, 260) / 2 / U) * U;
  const ry = Math.max(U * 3, Math.round(rx / 5 / U) * U);
  const feet = Math.round((height - ry * 2 - 18) / U) * U;
  const horizon = Math.round((feet - ry * 2) / U) * U;
  return { cx, rx, ry, feet, horizon };
}

/** Plays a few frames of "materialising" on mount: the child flickers in through scan bands. */
export function Materialize({ children, color, style }: { children: ReactNode; color: string; style?: StyleProp<ViewStyle> }) {
  const [f, setF] = useState(0);
  useEffect(() => {
    if (f >= 5) return;
    const t = setTimeout(() => setF(f + 1), 55);
    return () => clearTimeout(t);
  }, [f]);
  const op = [0.1, 0.35, 0.2, 0.7, 0.9, 1][f];
  return (
    <View style={style} pointerEvents="box-none">
      <View style={{ opacity: op }} pointerEvents="box-none">
        {children}
      </View>
      {f < 5 ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
          {Array.from({ length: 24 }, (_, i) => (
            <View key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${(i * 100) / 24}%`, height: U, backgroundColor: alpha(color, (i + f) % 3 === 0 ? 0.35 : 0.08) }} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export interface PagerRef {
  go: (dir: 1 | -1) => void;
}
/**
 * Swipe through `count` pages one at a time: drag (finger or mouse), the arrows, or the keyboard via `go`. Only the
 * page on show and its two neighbours are drawn, and it wraps round at both ends.
 */
export const Pager = forwardRef<PagerRef, { width: number; height: number; count: number; index: number; onIndex: (i: number) => void; render: (i: number, center: boolean) => ReactNode }>(
  function Pager({ width, height, count, index, onIndex, render }, ref) {
    const x = useRef(new Animated.Value(0)).current;
    const busy = useRef(false);
    const st = useRef({ index, count, width, onIndex });
    st.current = { index, count, width, onIndex };
    const slide = (dir: 1 | -1, v = 0) => {
      const { index: i, count: n, width: w } = st.current;
      if (n < 2 || busy.current) {
        Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 6 }).start();
        return;
      }
      busy.current = true;
      play('select');
      haptic.tap();
      Animated.timing(x, { toValue: -dir * w, duration: Math.max(120, 240 - Math.abs(v) * 60), easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => {
        st.current.onIndex((i + dir + n) % n);
        x.setValue(0);
        busy.current = false;
      });
    };
    useImperativeHandle(ref, () => ({ go: (dir) => slide(dir) }));
    const pan = useMemo(
      () =>
        PanResponder.create({
          onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
          onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
          onPanResponderTerminationRequest: () => false,
          onPanResponderMove: (_, g) => {
            if (!busy.current) x.setValue(st.current.count < 2 ? g.dx * 0.25 : g.dx);
          },
          onPanResponderRelease: (_, g) => {
            const w = st.current.width;
            if (g.dx < -w * 0.16 || g.vx < -0.45) slide(1, g.vx);
            else if (g.dx > w * 0.16 || g.vx > 0.45) slide(-1, g.vx);
            else Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 8 }).start();
          },
          onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: false }).start(),
        }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );
    if (!count) return null;
    const pages = count < 2 ? [0] : count === 2 ? [-1, 0, 1] : [-1, 0, 1];
    return (
      <View style={{ width, height, overflow: 'hidden' }} {...pan.panHandlers}>
        {pages.map((o) => {
          const i = (index + o + count) % count;
          return (
            <Animated.View key={`${o}:${i}`} style={{ position: 'absolute', left: 0, top: 0, width, height, transform: [{ translateX: Animated.add(x, o * width) }] }}>
              {render(i, o === 0)}
            </Animated.View>
          );
        })}
      </View>
    );
  },
);

/** A console button: dark slab with a lit border, or filled when `primary`. */
export function TechBtn({
  label,
  onPress,
  color = COLORS.teal,
  primary = false,
  disabled = false,
  small = false,
  icon,
  style,
  kbd,
}: {
  label: string;
  onPress?: () => void;
  color?: string;
  primary?: boolean;
  disabled?: boolean;
  small?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  kbd?: string;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        play('select');
        onPress?.();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      style={style}
    >
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        const fill = primary ? (disabled ? alpha(color, 0.25) : hovered ? alpha(color, 0.92) : color) : hovered && !disabled ? alpha(color, 0.16) : alpha(color, 0.06);
        return (
          <View
            style={[
              styles.btn,
              small && styles.btnSmall,
              { backgroundColor: fill, borderColor: disabled ? alpha(color, 0.3) : color, transform: [{ translateY: pressed && !disabled ? U : 0 }] },
            ]}
          >
            {icon}
            <T v="display" numberOfLines={1} style={{ fontSize: small ? 15 : 18, lineHeight: small ? 16 : 19, letterSpacing: 1, color: primary ? TECH.ink : disabled ? alpha(color, 0.45) : color }}>
              {label}
            </T>
            {kbd && isWeb ? (
              <T v="tiny" style={{ fontSize: 8, color: primary ? alpha('#000000', 0.55) : alpha(color, 0.6) }}>
                {kbd}
              </T>
            ) : null}
            {!primary ? <Corners color={disabled ? alpha(color, 0.3) : color} size={5} w={U} inset={-U * 2} /> : null}
            {focused && isWeb ? <FocusRing /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

/** A tab on a console strip: LED, label and a count, with a lit bar under it when chosen. */
export function TechTab({ label, count, on, onPress, icon, color = COLORS.teal }: { label: string; count?: string; on: boolean; onPress: () => void; icon?: ReactNode; color?: string }) {
  return (
    <Pressable
      onPress={() => {
        play('select');
        onPress();
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      {(st) => {
        const { hovered, focused } = st as { hovered?: boolean; focused?: boolean };
        return (
          <View style={[styles.tab, { backgroundColor: on ? alpha(color, 0.14) : hovered ? alpha(color, 0.07) : 'transparent', borderColor: on ? alpha(color, 0.7) : TECH.rule }]}>
            <Led color={color} on={on} size={4} />
            {icon}
            <T v="display" numberOfLines={1} style={{ fontSize: 17, lineHeight: 18, letterSpacing: 1, color: on ? color : COLORS.text }}>
              {label}
            </T>
            {count ? (
              <T v="tiny" style={{ fontSize: 9, color: on ? alpha(color, 0.85) : TECH.dim }}>
                {count}
              </T>
            ) : null}
            {on ? <View style={[styles.tabBar, { backgroundColor: color }]} /> : null}
            {focused && isWeb ? <FocusRing /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

/** A panel with a title strip: `// TITLE` on the left, anything on the right. */
export function TechPanel({ title, right, children, color = COLORS.teal, style }: { title: string; right?: ReactNode; children: ReactNode; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.panelHead}>
        <View style={{ width: U * 2, height: 12, backgroundColor: color }} />
        <T v="tiny" style={{ fontSize: 10, letterSpacing: 1, color, flex: 1 }} numberOfLines={1}>
          {title}
        </T>
        {right}
      </View>
      {children}
      <Corners color={alpha(color, 0.55)} size={8} />
    </View>
  );
}

/** "> text_" with a blinking cursor. */
export function Prompt({ text, color = COLORS.teal, style }: { text: string; color?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTick(530);
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6 }, style]}>
      <T v="tiny" numberOfLines={1} style={{ fontSize: 10, color: alpha(color, 0.9), letterSpacing: 0.6, flexShrink: 1 }}>
        {'> '}
        {text}
      </T>
      <View style={{ width: 6, height: 10, backgroundColor: t % 2 ? 'transparent' : color }} />
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22 },
  readK: { fontSize: 9, letterSpacing: 1, color: TECH.dim },
  readDots: { flex: 1, height: U, borderBottomWidth: U, borderStyle: 'dotted', borderColor: TECH.rule, marginTop: 4 },
  btn: { minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: U },
  btnSmall: { minHeight: 34, paddingHorizontal: 10 },
  tab: { height: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: U },
  tabBar: { position: 'absolute', left: -U, right: -U, bottom: -U * 3, height: U * 2 },
  panel: { backgroundColor: TECH.panel, borderWidth: U, borderColor: TECH.rule, padding: 12, gap: 8 },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
});

export { F };
