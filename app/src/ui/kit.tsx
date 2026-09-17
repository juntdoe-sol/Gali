import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { haptic } from '../game/sfx';

// Pixelify Sans for titles, numbers and buttons; Chakra Petch for everything else.
export const F = {
  display: 'PixelifySans_700Bold',
  body: 'ChakraPetch_500Medium',
  bold: 'ChakraPetch_600SemiBold',
  black: 'ChakraPetch_700Bold',
};

export function T({
  children,
  style,
  v = 'body',
  numberOfLines,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  v?: 'body' | 'bold' | 'black' | 'display' | 'muted' | 'label';
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        styles.base,
        v === 'bold' && styles.bold,
        v === 'black' && styles.black,
        v === 'display' && styles.display,
        v === 'muted' && styles.muted,
        v === 'label' && styles.label,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Small rotated square used as a trim ornament. */
export function Gem({ size = 7, color = COLORS.trim, style }: { size?: number; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      pointerEvents="none"
      style={[{ width: size, height: size, backgroundColor: color, transform: [{ rotate: '45deg' }], borderWidth: 1, borderColor: COLORS.trimHi }, style]}
    />
  );
}

/** Arena panel: navy gradient, gold trim, a lit top edge and gem ornaments. */
export function Frame({
  children,
  style,
  glow,
  gems = true,
  radius = 14,
  colors = [COLORS.card2, COLORS.card, COLORS.bg2],
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  glow?: string;
  gems?: boolean;
  radius?: number;
  colors?: readonly [string, string, ...string[]];
}) {
  const edge = glow ?? COLORS.trim;
  return (
    <View style={[styles.frame, { borderColor: edge, borderRadius: radius, shadowColor: glow ?? '#000' }, style]}>
      <LinearGradient colors={colors} style={[StyleSheet.absoluteFill, { borderRadius: radius - 1 }]} />
      <View pointerEvents="none" style={[styles.innerLine, { borderRadius: Math.max(0, radius - 3) }]} />
      <View pointerEvents="none" style={[styles.topLit, { left: radius, right: radius }]} />
      {gems ? (
        <>
          <Gem size={6} color={edge} style={[styles.gem, { top: -4, left: radius + 2 }]} />
          <Gem size={6} color={edge} style={[styles.gem, { top: -4, right: radius + 2 }]} />
        </>
      ) : null}
      {children}
    </View>
  );
}

export function Card({ children, style, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; glow?: string }) {
  return (
    <Frame style={[{ padding: 14 }, style]} glow={glow} gems={false}>
      {children}
    </Frame>
  );
}

const BTN_COLORS = {
  gold: ['#fff2b8', '#ffcf4a', '#e0901f'] as const,
  skr: ['#efffc9', '#c7f284', '#7fbf3c'] as const,
  plain: ['#2f5499', '#1a3368', '#12244c'] as const,
};

export function Btn({
  label,
  onPress,
  kind = 'plain',
  disabled,
  style,
  sub,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: 'plain' | 'gold' | 'ghost' | 'skr';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  sub?: string;
  small?: boolean;
}) {
  const bright = kind === 'gold' || kind === 'skr';
  const radius = small ? 8 : 12;
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { borderRadius: radius },
        kind === 'gold' && styles.goldBtn,
        kind === 'skr' && styles.skrBtn,
        kind === 'ghost' && styles.ghost,
        { opacity: disabled ? 0.5 : 1, transform: [{ translateY: pressed ? 2 : 0 }, { scale: pressed ? 0.985 : 1 }] },
        pressed || kind === 'ghost' ? null : bright && !disabled ? styles.brightShadow : styles.shadow,
        style,
      ]}
    >
      {kind !== 'ghost' ? <LinearGradient colors={BTN_COLORS[kind]} style={[StyleSheet.absoluteFill, { borderRadius: radius - 2 }]} /> : null}
      {kind !== 'ghost' ? <View pointerEvents="none" style={styles.btnShine} /> : null}
      {kind === 'gold' && !small ? (
        <>
          <Gem size={8} color="#8a4b0a" style={{ position: 'absolute', left: 12, top: '50%', marginTop: -4 }} />
          <Gem size={8} color="#8a4b0a" style={{ position: 'absolute', right: 12, top: '50%', marginTop: -4 }} />
        </>
      ) : null}
      <T
        v={bright ? 'display' : 'black'}
        style={[
          {
            fontSize: small ? 12 : kind === 'gold' ? 20 : 14,
            letterSpacing: kind === 'gold' ? 1 : 0.6,
            color: bright ? '#3a1800' : COLORS.text,
            textAlign: 'center',
          },
          kind === 'skr' && { color: '#1f3a00' },
        ]}
      >
        {label}
      </T>
      {sub ? (
        <T v="bold" style={{ fontSize: 11, color: kind === 'gold' ? '#6b3a00' : kind === 'skr' ? '#2f4a00' : COLORS.muted, textAlign: 'center' }}>
          {sub}
        </T>
      ) : null}
    </Pressable>
  );
}

export function Pill({ text, color = COLORS.bg2, fg = COLORS.text }: { text: string; color?: string; fg?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color, borderColor: color === COLORS.bg2 ? COLORS.trim : color }]}>
      <T v="black" style={{ fontSize: 11, color: fg, letterSpacing: 0.4 }} numberOfLines={1}>
        {text}
      </T>
    </View>
  );
}

export function Bar({ pct, colors = [COLORS.gold2, COLORS.gold], height = 8 }: { pct: number; colors?: [string, string]; height?: number }) {
  return (
    <View style={[styles.bar, { height: height + 2, borderRadius: height }]}>
      <LinearGradient
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        colors={colors}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: height }}
      />
      <View pointerEvents="none" style={[styles.barShine, { height: Math.max(1, height / 3) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { color: COLORS.text, fontFamily: F.body, fontSize: 14 },
  bold: { fontFamily: F.bold },
  black: { fontFamily: F.black },
  display: { fontFamily: F.display, letterSpacing: 0.4 },
  muted: { color: COLORS.muted, fontSize: 12 },
  label: { color: COLORS.muted, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', fontFamily: F.black },
  frame: {
    borderWidth: 1.5,
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  innerLine: { position: 'absolute', top: 2, left: 2, right: 2, bottom: 2, borderWidth: 1, borderColor: '#ffffff12' },
  topLit: { position: 'absolute', top: 0, height: 1, backgroundColor: COLORS.trimHi, opacity: 0.7 },
  gem: { position: 'absolute' },
  btn: {
    minHeight: 46,
    paddingHorizontal: 16,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#5d8ae0',
    borderBottomWidth: 3,
    borderBottomColor: '#0a1733',
    overflow: 'hidden',
  },
  btnSmall: { minHeight: 34, paddingHorizontal: 12, paddingVertical: 5 },
  goldBtn: { borderColor: COLORS.trimHi, borderBottomColor: '#8a4b0a', borderBottomWidth: 4 },
  skrBtn: { borderColor: '#efffc9', borderBottomColor: '#3f6b12', borderBottomWidth: 4 },
  ghost: { backgroundColor: 'transparent', borderColor: COLORS.line, borderBottomWidth: 1.5, borderBottomColor: COLORS.line },
  btnShine: { position: 'absolute', top: 0, left: 0, right: 0, height: '42%', backgroundColor: '#ffffff1f' },
  shadow: { shadowColor: '#000', shadowOpacity: 0.5, shadowOffset: { width: 0, height: 4 }, shadowRadius: 6, elevation: 4 },
  brightShadow: { shadowColor: '#ffb020', shadowOpacity: 0.55, shadowOffset: { width: 0, height: 0 }, shadowRadius: 14, elevation: 8 },
  pill: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  bar: { backgroundColor: '#02061499', borderWidth: 1, borderColor: '#ffffff22', overflow: 'hidden' },
  barShine: { position: 'absolute', top: 1, left: 2, right: 2, backgroundColor: '#ffffff40', borderRadius: 4 },
});
