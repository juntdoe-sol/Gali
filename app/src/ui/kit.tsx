/**
 * Gali's pixel interface kit.
 *
 * Everything is drawn from flat colour blocks so it sits in the same world as the island:
 * a 1-unit dark outline with notched corners, a light bevel on the top and left, a dark
 * bevel on the bottom and right, and a hard drop shadow. No gradients, no rounded corners,
 * no blur. The unit is 2 CSS px, so on any screen the frame lines up with the art's pixels.
 *
 * The exports keep their old names (Frame, Card, Btn, Pill, Bar, T, Gem), so every screen
 * picks up the look without changing how it is built.
 */
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { IS_HOLLOW } from '../game/season';
import { haptic } from '../game/sfx';
import { LANDSCAPE_APP, useLayout } from './layout';

// Jersey 15 (a pixel font with clear digits) for titles, numbers, labels and buttons; Pixelify Sans for reading;
// Silkscreen, tiny caps, for key hints and tags.
export const F = {
  display: 'Jersey15_400Regular',
  body: 'PixelifySans_400Regular',
  bold: 'PixelifySans_600SemiBold',
  black: 'PixelifySans_700Bold',
  tiny: 'Silkscreen_400Regular',
};

/** One pixel of interface: frames, bevels and shadows are drawn in whole units of this. */
export const U = 2;

/** Pixel palette. `fill` the face, `hi` the lit bevel, `lo` the shaded bevel, `lip` the 3D edge of a button. */
export const TONE = {
  panel: { fill: 'rgba(21,32,70,0.94)', hi: '#33498c', lo: '#0c1430', edge: '#04060f' },
  glass: { fill: 'rgba(14,22,50,0.82)', hi: 'rgba(70,98,170,0.55)', lo: 'rgba(4,8,22,0.7)', edge: '#04060f' },
  dark: { fill: 'rgba(9,14,34,0.9)', hi: 'rgba(55,78,140,0.45)', lo: 'rgba(0,0,0,0.45)', edge: '#04060f' },
  well: { fill: '#060a1c', hi: '#02040c', lo: '#1e2c5c', edge: '#04060f' },
  gold: { fill: '#ffc93c', hi: '#fff1a6', lo: '#d27a12', edge: '#2a1400', lip: '#7a3d06', text: '#3a1800' },
  skr: { fill: '#a8e05a', hi: '#e6ffb0', lo: '#5d9a26', edge: '#142400', lip: '#2d5210', text: '#16300a' },
  steel: { fill: '#2e4d94', hi: '#5f86d8', lo: '#1b2f63', edge: '#04060f', lip: '#0b1430', text: '#f2f5ff' },
  red: { fill: '#e2493b', hi: '#ff9384', lo: '#a12a26', edge: '#1c0304', lip: '#5a1214', text: '#fff4f2' },
  teal: { fill: '#2fc7dd', hi: '#b6f6ff', lo: '#15809a', edge: '#021418', lip: '#0a4250', text: '#032026' },
} as const;
export type ToneName = keyof typeof TONE;

/**
 * Hollow Night re-tints the kit: navy blues lean purple (gold, green and cyan are left alone), and the gold
 * button turns pumpkin. Looks only; nothing a button does changes.
 */
const tintCache = new Map<string, string>();
export function seasonTint(col: string | undefined): string | undefined {
  if (!IS_HOLLOW || !col) return col;
  const hit = tintCache.get(col);
  if (hit) return hit;
  let r = 0, g = 0, b = 0, a = 1, ok = false;
  const hx = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(col);
  const rg = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(col);
  if (hx) { const n = parseInt(hx[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; a = hx[2] ? parseInt(hx[2], 16) / 255 : 1; ok = true; }
  else if (rg) { r = +rg[1]; g = +rg[2]; b = +rg[3]; a = rg[4] !== undefined ? +rg[4] : 1; ok = true; }
  let out = col;
  if (ok && b > r + 20 && b >= g && g < b * 0.75) {
    const r2 = Math.min(255, Math.round(r + (b - r) * 0.5)), g2 = Math.round(g * 0.85);
    out = a < 1 ? `rgba(${r2},${g2},${b},${a})` : `#${((1 << 24) | (r2 << 16) | (g2 << 8) | b).toString(16).slice(1)}`;
  }
  tintCache.set(col, out);
  return out;
}
if (IS_HOLLOW) {
  Object.assign(TONE.gold, { fill: '#ff9a2e', hi: '#ffd08a', lo: '#c2560c', edge: '#2a0e00', lip: '#6a2a04', text: '#2a0e00' });
  Object.assign(TONE.teal, { fill: '#6fe05a', hi: '#d4ffc4', lo: '#2f8a26', edge: '#071a04', lip: '#1d4a14', text: '#0b2406' });
}

const isWeb = Platform.OS === 'web';

export function T({
  children,
  style,
  v = 'body',
  numberOfLines,
  selectable,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  v?: 'body' | 'bold' | 'black' | 'display' | 'muted' | 'label' | 'tiny' | 'num';
  numberOfLines?: number;
  selectable?: boolean;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      selectable={selectable}
      style={[
        styles.base,
        v === 'bold' && styles.bold,
        v === 'black' && styles.black,
        v === 'display' && styles.display,
        v === 'muted' && styles.muted,
        v === 'label' && styles.label,
        v === 'tiny' && styles.tiny,
        v === 'num' && styles.num,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The frame every panel, card and button is built from. Two overlapping rectangles make the
 * outline with its notched corners, so the corners stay see-through over the map.
 */
export function PixelBox({
  children,
  style,
  fill,
  hi,
  lo,
  edge = '#04060f',
  u = U,
  shadow = 0,
  inset = false,
  rivets,
  pointerEvents,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill: string;
  hi?: string;
  lo?: string;
  edge?: string;
  u?: number;
  /** hard drop shadow, in units */
  shadow?: number;
  /** swap the bevels so the box reads as a hole (inputs, wells) */
  inset?: boolean;
  /** colour of the four corner rivets, or none */
  rivets?: string;
  pointerEvents?: 'box-none' | 'none' | 'auto' | 'box-only';
}) {
  fill = seasonTint(fill) as string;
  hi = seasonTint(hi);
  lo = seasonTint(lo);
  edge = seasonTint(edge) as string;
  const top = inset ? lo : hi;
  const bottom = inset ? hi : lo;
  const s = shadow * u;
  return (
    <View style={style} pointerEvents={pointerEvents}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {s ? (
          <>
            {/* the hard shadow: only the parts that stick out below and to the right, so see-through faces stay clean */}
            <View style={{ position: 'absolute', left: s + u, right: -s + u, bottom: -s, height: s, backgroundColor: 'rgba(2,4,12,0.55)' }} />
            <View style={{ position: 'absolute', top: s + u, bottom: u, right: -s, width: s, backgroundColor: 'rgba(2,4,12,0.55)' }} />
          </>
        ) : null}
        {/* the outline: four strips, which leaves the corner pixel out and gives the notched corner */}
        <View style={{ position: 'absolute', left: u, right: u, top: 0, height: u, backgroundColor: edge }} />
        <View style={{ position: 'absolute', left: u, right: u, bottom: 0, height: u, backgroundColor: edge }} />
        <View style={{ position: 'absolute', left: 0, top: u, bottom: u, width: u, backgroundColor: edge }} />
        <View style={{ position: 'absolute', right: 0, top: u, bottom: u, width: u, backgroundColor: edge }} />
        <View style={{ position: 'absolute', left: u, right: u, top: u, bottom: u, backgroundColor: fill }} />
        {top ? (
          <>
            <View style={{ position: 'absolute', left: u, right: 2 * u, top: u, height: u, backgroundColor: top }} />
            <View style={{ position: 'absolute', left: u, top: 2 * u, bottom: 2 * u, width: u, backgroundColor: top }} />
          </>
        ) : null}
        {bottom ? (
          <>
            <View style={{ position: 'absolute', left: 2 * u, right: u, bottom: u, height: u, backgroundColor: bottom }} />
            <View style={{ position: 'absolute', right: u, top: 2 * u, bottom: u, width: u, backgroundColor: bottom }} />
          </>
        ) : null}
        {rivets ? (
          <>
            <View style={[styles.rivet, { left: 3 * u, top: 3 * u, backgroundColor: rivets }]} />
            <View style={[styles.rivet, { right: 3 * u, top: 3 * u, backgroundColor: rivets }]} />
            <View style={[styles.rivet, { left: 3 * u, bottom: 3 * u, backgroundColor: rivets }]} />
            <View style={[styles.rivet, { right: 3 * u, bottom: 3 * u, backgroundColor: rivets }]} />
          </>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A pixel diamond (a gem or a rivet ornament). */
export function Gem({ size = 7, color = COLORS.gold, style }: { size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  const u = Math.max(1, Math.round(size / 4));
  return (
    <View pointerEvents="none" style={[{ width: u * 4, height: u * 4 }, style]}>
      <View style={{ position: 'absolute', left: u, right: u, top: 0, bottom: 0, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: 0, right: 0, top: u, bottom: u, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: u, top: u, width: u, height: u, backgroundColor: '#ffffffaa' }} />
    </View>
  );
}

/**
 * A panel. `glow` tints the outline and rivets (a cave-in round goes red, a quest goes teal).
 * `radius` and `colors` are accepted for old callers and ignored: pixel panels are square and flat.
 */
export function Frame({
  children,
  style,
  glow,
  gems = true,
  tone = 'panel',
  pointerEvents,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: string;
  gems?: boolean;
  radius?: number;
  colors?: readonly string[];
  tone?: 'panel' | 'glass' | 'dark';
  pointerEvents?: 'box-none' | 'none' | 'auto' | 'box-only';
}) {
  const t = TONE[tone];
  return (
    <PixelBox
      fill={t.fill}
      hi={glow ? glow + '99' : t.hi}
      lo={t.lo}
      edge={t.edge}
      shadow={2}
      rivets={gems ? glow ?? COLORS.trim : undefined}
      style={style}
      pointerEvents={pointerEvents}
    >
      {glow ? <View pointerEvents="none" style={[styles.glowLine, { backgroundColor: glow }]} /> : null}
      {children}
    </PixelBox>
  );
}

export function Card({ children, style, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; glow?: string }) {
  const t = TONE.dark;
  return (
    <PixelBox fill={t.fill} hi={glow ? glow + '88' : t.hi} lo={t.lo} edge={t.edge} style={[{ padding: 14 }, style]}>
      {children}
    </PixelBox>
  );
}

/** A keyboard shortcut hint, shown only to mouse-and-keyboard players on a wide screen. */
export function Kbd({ k, style, dark }: { k: string; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  const { mouse, desktop } = useLayout();
  if (!mouse || !desktop) return null;
  return (
    <PixelBox fill={dark ? 'rgba(255,255,255,0.35)' : '#0a1230'} hi={dark ? 'rgba(255,255,255,0.6)' : '#2a3f7a'} edge={dark ? 'rgba(42,20,0,0.55)' : '#04060f'} u={1} style={[styles.kbd, style]}>
      <T v="tiny" style={{ fontSize: 8, lineHeight: 10, color: dark ? '#3a1800' : COLORS.muted }}>
        {k}
      </T>
    </PixelBox>
  );
}

/** Hover help for mouse players. Touch players get the same text from the (i) button as a toast. */
export function Tip({ text, children, side = 'top', style, width = 240 }: { text: string; children: ReactNode; side?: 'top' | 'bottom' | 'right'; style?: StyleProp<ViewStyle>; width?: number }) {
  const [on, setOn] = useState(false);
  if (!isWeb) return <View style={style}>{children}</View>;
  const hover = { onMouseEnter: () => setOn(true), onMouseLeave: () => setOn(false) } as object;
  return (
    <View style={[{ position: 'relative' }, style]} {...hover}>
      {children}
      {on ? (
        <PixelBox
          pointerEvents="none"
          fill="#0b1229"
          hi="#3a54a0"
          lo="#050916"
          shadow={2}
          style={[
            styles.tip,
            { width },
            side === 'top' ? { bottom: '100%', marginBottom: 8, left: '50%', marginLeft: -width / 2 } : side === 'bottom' ? { top: '100%', marginTop: 8, left: '50%', marginLeft: -width / 2 } : { left: '100%', marginLeft: 10, top: -4 },
          ]}
        >
          <T style={{ fontSize: 13, lineHeight: 17 }}>{text}</T>
        </PixelBox>
      ) : null}
    </View>
  );
}

const BTN_TONE = { gold: TONE.gold, skr: TONE.skr, plain: TONE.steel, red: TONE.red, teal: TONE.teal } as const;

export function Btn({
  label,
  onPress,
  kind = 'plain',
  disabled,
  style,
  sub,
  small,
  kbd,
  icon,
}: {
  label: string;
  onPress: () => void;
  kind?: 'plain' | 'gold' | 'ghost' | 'skr' | 'red' | 'teal';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  sub?: string;
  small?: boolean;
  /** a keyboard shortcut shown on desktop */
  kbd?: string;
  icon?: ReactNode;
}) {
  const lip = small ? U : 2 * U;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={[styles.btnWrap, style]}
    >
      {(st) => {
        const { pressed, hovered, focused } = st as { pressed: boolean; hovered?: boolean; focused?: boolean };
        const down = pressed && !disabled;
        if (kind === 'ghost') {
          return (
            <PixelBox
              fill={hovered && !disabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.02)'}
              edge={hovered && !disabled ? COLORS.gold : '#3a5290'}
              style={[styles.btn, small && styles.btnSmall, { opacity: disabled ? 0.45 : 1, transform: [{ translateY: down ? U : 0 }] }]}
            >
              <BtnText label={label} sub={sub} small={small} color={hovered && !disabled ? COLORS.gold : COLORS.text} subColor={COLORS.muted} icon={icon} kbd={kbd} />
              {focused && isWeb ? <FocusRing /> : null}
            </PixelBox>
          );
        }
        const t = BTN_TONE[kind];
        const bright = hovered && !disabled;
        return (
          <View style={{ opacity: disabled ? 0.5 : 1, paddingBottom: down ? 0 : lip, marginTop: down ? lip : 0 }}>
            {/* the lip under the face: the button's 3D edge */}
            {!down ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: lip }]}>
                <View style={{ position: 'absolute', left: U, right: U, top: 0, bottom: 0, backgroundColor: t.edge }} />
                <View style={{ position: 'absolute', left: 0, right: 0, top: U, bottom: U, backgroundColor: t.edge }} />
                <View style={{ position: 'absolute', left: U, right: U, top: U, bottom: U, backgroundColor: t.lip }} />
              </View>
            ) : null}
            <PixelBox
              fill={bright ? t.hi : t.fill}
              hi={bright ? '#ffffff' : t.hi}
              lo={t.lo}
              edge={t.edge}
              style={[styles.btn, small && styles.btnSmall, kind === 'gold' && !small && styles.btnBig]}
            >
              {kind === 'gold' && !small ? (
                <>
                  <Gem size={8} color={t.lo} style={styles.btnGemL} />
                  <Gem size={8} color={t.lo} style={styles.btnGemR} />
                </>
              ) : null}
              <BtnText label={label} sub={sub} small={small} big={kind === 'gold' && !small} color={t.text} subColor={kind === 'plain' || kind === 'red' ? 'rgba(255,255,255,0.72)' : t.lip} icon={icon} kbd={kbd} dark={kind !== 'plain' && kind !== 'red'} />
            </PixelBox>
            {focused && isWeb ? <FocusRing /> : null}
          </View>
        );
      }}
    </Pressable>
  );
}

function BtnText({ label, sub, small, big, color, subColor, icon, kbd, dark }: { label: string; sub?: string; small?: boolean; big?: boolean; color: string; subColor: string; icon?: ReactNode; kbd?: string; dark?: boolean }) {
  return (
    <>
      <View style={styles.btnRow}>
        {icon}
        <T v="display" numberOfLines={1} style={{ fontSize: small ? 15 : big ? 22 : 18, lineHeight: small ? 17 : big ? 24 : 20, letterSpacing: 1, color, textAlign: 'center', textTransform: 'uppercase' }}>
          {label}
        </T>
        {kbd ? <Kbd k={kbd} dark={dark} /> : null}
      </View>
      {sub ? (
        <T v="bold" numberOfLines={1} style={{ fontSize: 12, lineHeight: 15, color: subColor, textAlign: 'center' }}>
          {sub}
        </T>
      ) : null}
    </>
  );
}

/**
 * Keyboard focus on the web: a dashed gold outline a unit outside the control. Like :focus-visible it shows
 * only after the keyboard moved focus (Tab, arrows), never after a click or a tap.
 */
let keyboardNav = false;
if (isWeb && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key.startsWith('Arrow')) keyboardNav = true;
  }, true);
  window.addEventListener('pointerdown', () => {
    keyboardNav = false;
  }, true);
}
export function FocusRing() {
  if (!keyboardNav) return null;
  return <View pointerEvents="none" style={styles.focus} />;
}

/** A small flat tag. */
export function Pill({ text, color = COLORS.bg2, fg = COLORS.text }: { text: string; color?: string; fg?: string }) {
  const plain = color === COLORS.bg2;
  return (
    <PixelBox fill={plain ? '#0b1430' : color} edge={plain ? COLORS.trim : '#04060f'} u={1.5} style={styles.pill}>
      <T v="display" style={{ fontSize: 15, lineHeight: 16, color: fg, letterSpacing: 0.8 }} numberOfLines={1}>
        {text}
      </T>
    </PixelBox>
  );
}

/** A progress bar: a dark well filled with a flat colour and a lit top row. */
export function Bar({ pct, colors = [COLORS.gold2, COLORS.gold], height = 8 }: { pct: number; colors?: [string, string]; height?: number }) {
  const p = Math.max(0, Math.min(100, pct));
  const h = Math.max(4, Math.round(height / U) * U);
  return (
    <PixelBox fill="#050817" edge="#04060f" lo="#1d2a58" style={{ height: h + 2 * U }}>
      <View style={{ position: 'absolute', left: U, top: U, bottom: U, width: `${p}%`, maxWidth: '100%' }}>
        <View style={[StyleSheet.absoluteFill, { right: p >= 99.5 ? U : 0, backgroundColor: colors[1] }]} />
        <View style={{ position: 'absolute', left: 0, right: p >= 99.5 ? U : 0, bottom: 0, height: Math.max(U, Math.round(h / 3)), backgroundColor: colors[0] }} />
        <View style={{ position: 'absolute', left: 0, right: p >= 99.5 ? U : 0, top: 0, height: U, backgroundColor: '#ffffff66' }} />
      </View>
    </PixelBox>
  );
}

/** A square icon button (close, back, power). */
export function IconBtn({ children, onPress, label, style, active, kbd }: { children: ReactNode; onPress: () => void; label: string; style?: StyleProp<ViewStyle>; active?: boolean; kbd?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={style}>
      {(st) => {
        const { pressed, hovered, focused } = st as { pressed: boolean; hovered?: boolean; focused?: boolean };
        return (
          <PixelBox
            fill={active ? '#2a3f7a' : hovered ? '#22346a' : 'rgba(12,20,46,0.9)'}
            hi={hovered || active ? COLORS.trimHi + 'aa' : '#2d4282'}
            lo="#060b1c"
            shadow={pressed ? 0 : 1}
            style={[styles.iconBtn, { transform: [{ translateY: pressed ? U : 0 }] }]}
          >
            {children}
            {kbd ? <Kbd k={kbd} style={styles.iconKbd} /> : null}
            {focused && isWeb ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { color: COLORS.text, fontFamily: F.body, fontSize: 14 },
  bold: { fontFamily: F.bold },
  black: { fontFamily: F.black },
  display: { fontFamily: F.display, letterSpacing: 0.5 },
  muted: { color: COLORS.muted, fontSize: 13 },
  label: { color: COLORS.muted, fontSize: 15, lineHeight: 16, letterSpacing: 1.6, textTransform: 'uppercase', fontFamily: F.display },
  // numbers: Jersey 15's digits are easy to tell apart (Pixelify's 1 and 7, 5 and 8 are close at small sizes)
  num: { fontFamily: F.display, letterSpacing: 0.6, fontVariant: ['tabular-nums'] },
  tiny: { fontFamily: F.tiny, fontSize: 8, letterSpacing: 0.5, textTransform: 'uppercase' },
  rivet: { position: 'absolute', width: U * 1.5, height: U * 1.5, opacity: 0.9 },
  glowLine: { position: 'absolute', left: 4 * U, right: 4 * U, top: 0, height: U },
  btnWrap: { alignSelf: 'stretch' },
  btn: { minHeight: 46, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
  btnBig: { minHeight: 52 },
  btnSmall: { minHeight: 32, paddingHorizontal: 10, paddingVertical: 4 },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnGemL: { position: 'absolute', left: 12, top: '50%', marginTop: -4 },
  btnGemR: { position: 'absolute', right: 12, top: '50%', marginTop: -4 },
  focus: {
    position: 'absolute',
    left: -2 * U,
    right: -2 * U,
    top: -2 * U,
    bottom: -2 * U,
    borderWidth: U,
    borderStyle: 'dashed',
    borderColor: COLORS.gold,
  },
  pill: { paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  kbd: { paddingHorizontal: 4, paddingVertical: 2, minWidth: 14, alignItems: 'center' },
  tip: { position: 'absolute', padding: 10, zIndex: 1000 },
  iconBtn: { minWidth: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  iconKbd: { position: 'absolute', right: -6, bottom: -6 },
  scrimScroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 10 },
  modalCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,6,15,0.55)', padding: 16 },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(4,6,15,0.72)', alignItems: 'center', justifyContent: 'center', padding: 12, zIndex: 60 },
  window: { padding: 16, gap: 10 },
  winHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  winRule: { height: U, backgroundColor: '#22356f', marginHorizontal: -4 },
  choice: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 12 },
  mapCount: { minWidth: 24, height: 22, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
});

/** A floating button over the map: a pixel plate with an icon, a label, an optional count and key. */
/**
 * A button over the game map. `instant` fires on touch-down: use it for fight and move actions, so they
 * work while another finger holds the stick (a multi-touch release never fires onPress on mobile web).
 */
export function MapButton({ label, onPress, icon, count, kbd, accessibilityLabel, tone = 'dark', instant }: { label: string; onPress: () => void; icon?: ReactNode; count?: number; kbd?: string; accessibilityLabel?: string; tone?: 'dark' | 'gold'; instant?: boolean }) {
  const fire = () => {
    haptic.tap();
    onPress();
  };
  return (
    <Pressable
      onPress={instant ? undefined : fire}
      onPressIn={instant ? fire : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        const gold = tone === 'gold';
        return (
          <PixelBox
            fill={gold ? (hovered ? TONE.gold.hi : TONE.gold.fill) : hovered ? '#22346a' : 'rgba(8,13,32,0.92)'}
            hi={gold ? '#ffffff' : COLORS.trim}
            lo={gold ? TONE.gold.lo : '#04060f'}
            edge={gold ? TONE.gold.edge : '#04060f'}
            shadow={pressed ? 0 : 2}
            style={[styles.mapBtn, { transform: [{ translateY: pressed ? U : hovered ? -U : 0 }] }]}
          >
            {icon}
            <T v="display" style={{ fontSize: 19, lineHeight: 20, letterSpacing: 1, color: gold ? TONE.gold.text : COLORS.gold }}>
              {label}
            </T>
            {count !== undefined ? (
              <PixelBox fill={count ? COLORS.gold : '#5a6a8a'} edge="#04060f" u={1.5} style={styles.mapCount}>
                <T v="display" style={{ fontSize: 16, lineHeight: 17, color: '#070d20' }}>
                  {count}
                </T>
              </PixelBox>
            ) : null}
            {kbd ? <Kbd k={kbd} dark={gold} /> : null}
            {focused && isWeb ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

/** The dimmed backdrop behind a dialog. Tapping it closes the dialog when `onPress` is given. */
export function Scrim({ onPress, children, style }: { onPress?: () => void; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (LANDSCAPE_APP) {
    // a phone held sideways is short: a tall window scrolls instead of running off the screen
    return (
      <View style={[styles.scrim, { padding: 0 }, style]}>
        <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={styles.scrimScroll} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {onPress ? <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityLabel="Close" /> : null}
          {children}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[styles.scrim, style]}>
      {onPress ? <Pressable style={StyleSheet.absoluteFill} onPress={onPress} accessibilityLabel="Close" /> : null}
      {children}
    </View>
  );
}

/** A centred modal body that scrolls on the short landscape screen. */
export function ModalCenter({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (!LANDSCAPE_APP) return <View style={[styles.modalCenter, style]}>{children}</View>;
  return (
    <View style={[styles.modalCenter, { padding: 0 }, style]}>
      <ScrollView style={{ alignSelf: 'stretch' }} contentContainerStyle={styles.scrimScroll} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * A dialog window: a riveted pixel panel with a title bar and an optional close button (Esc on desktop).
 * Phones get it nearly full width; wide screens get `width`.
 */
export function Window({
  title,
  onClose,
  children,
  width = 480,
  style,
  tone = 'panel',
  accent,
  sub,
}: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  width?: number;
  style?: StyleProp<ViewStyle>;
  tone?: 'panel' | 'glass';
  accent?: string;
  sub?: string;
}) {
  return (
    <Frame tone={tone} glow={accent} style={[styles.window, { width: '100%', maxWidth: width }, style]}>
      <View style={styles.winHead}>
        <View style={{ flex: 1 }}>
          <T v="display" numberOfLines={1} style={{ fontSize: 28, lineHeight: 30, letterSpacing: 1, color: accent ?? COLORS.text }}>
            {title}
          </T>
          {sub ? (
            <T v="muted" style={{ fontSize: 13 }}>
              {sub}
            </T>
          ) : null}
        </View>
        {onClose ? (
          <IconBtn onPress={onClose} label="Close" kbd="ESC">
            <T v="display" style={{ fontSize: 22, lineHeight: 22, color: COLORS.muted }}>
              X
            </T>
          </IconBtn>
        ) : null}
      </View>
      <View style={styles.winRule} />
      {children}
      {IS_HOLLOW ? <WebCorner /> : null}
    </Frame>
  );
}

/** Hollow Night: a cobweb in a window's bottom-right corner: threads from the corner, two sagging arcs. */
const WEB_N = 14;
const WEB_DOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let y = 0; y < WEB_N; y++)
    for (let x = 0; x < WEB_N; x++) {
      const dx = WEB_N - 1 - x, dy = WEB_N - 1 - y, d = Math.hypot(dx, dy);
      const thread = dx === 0 || dy === 0 || dx === dy || Math.abs(dx - 2 * dy) < 0.6 || Math.abs(dy - 2 * dx) < 0.6;
      const arc = Math.abs(d - 5) < 0.55 || Math.abs(d - 10) < 0.55;
      if ((thread || arc) && d < WEB_N) out.push([x, y]);
    }
  return out;
})();
function WebCorner() {
  const px = 2;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', right: 5, bottom: 5, width: WEB_N * px, height: WEB_N * px, opacity: 0.8 }}>
      {WEB_DOTS.map(([x, y]) => (
        <View key={`${x}.${y}`} style={{ position: 'absolute', left: x * px, top: y * px, width: px, height: px, backgroundColor: 'rgba(235,230,255,0.42)' }} />
      ))}
    </View>
  );
}

/** A toggle chip in a row of choices (tokens, amounts, presets). */
export function Choice({ label, on, onPress, sub, icon, grow = true, disabled }: { label: string; on: boolean; onPress: () => void; sub?: string; icon?: ReactNode; grow?: boolean; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: on, disabled: Boolean(disabled) }} accessibilityLabel={label} style={[grow && { flex: 1 }, disabled && { opacity: 0.45 }]}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox
            fill={on ? TONE.gold.fill : hovered ? '#1d2d5e' : '#0b1430'}
            hi={on ? TONE.gold.hi : '#2d4282'}
            lo={on ? TONE.gold.lo : '#04060f'}
            edge={on ? TONE.gold.edge : '#04060f'}
            style={[styles.choice, { transform: [{ translateY: pressed ? U : 0 }] }]}
          >
            {icon}
            <T v="display" numberOfLines={1} style={{ fontSize: 18, lineHeight: 19, color: on ? TONE.gold.text : COLORS.text, letterSpacing: 0.8 }}>
              {label}
            </T>
            {sub ? (
              <T v="bold" style={{ fontSize: 11, color: on ? TONE.gold.lip : COLORS.muted }}>
                {sub}
              </T>
            ) : null}
            {focused && isWeb ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

/** Text fields: a dark well with an inset bevel. Spread into a TextInput's style. */
export const INPUT: TextStyle = {
  height: 46,
  paddingHorizontal: 12,
  color: COLORS.text,
  fontFamily: F.body,
  fontSize: 16,
  backgroundColor: '#050817',
  borderWidth: U,
  borderTopColor: '#000000',
  borderLeftColor: '#000000',
  borderBottomColor: '#2d4282',
  borderRightColor: '#2d4282',
  ...((isWeb ? { outlineStyle: 'none' } : {}) as object),
};
