import { LinearGradient } from 'expo-linear-gradient';
import { type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { haptic } from '../game/sfx';

export const F = {
  display: 'LilitaOne_400Regular',
  body: 'Nunito_700Bold',
  bold: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
};

export function T({ children, style, v = 'body', numberOfLines }: { children: ReactNode; style?: StyleProp<TextStyle>; v?: 'body' | 'bold' | 'black' | 'display' | 'muted' | 'label'; numberOfLines?: number }) {
  return (
    <Text numberOfLines={numberOfLines} style={[styles.base, v === 'bold' && styles.bold, v === 'black' && styles.black, v === 'display' && styles.display, v === 'muted' && styles.muted, v === 'label' && styles.label, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; glow?: string }) {
  return <View style={[styles.card, glow ? { borderColor: glow } : null, style]}>{children}</View>;
}

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
  const inner = (
    <>
      <T v={kind === 'gold' ? 'display' : 'bold'} style={[{ fontSize: small ? 13 : kind === 'gold' ? 22 : 15, color: kind === 'gold' || kind === 'skr' ? '#3a1a00' : COLORS.text, textAlign: 'center' }]}>
        {label}
      </T>
      {sub ? <T style={{ fontSize: 11, color: kind === 'gold' ? '#6b3a00' : kind === 'skr' ? '#2f4a00' : COLORS.muted, textAlign: 'center' }}>{sub}</T> : null}
    </>
  );
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
        kind === 'ghost' && styles.ghost,
        { opacity: disabled ? 0.45 : 1, transform: [{ translateY: pressed ? 3 : 0 }] },
        pressed ? null : kind === 'gold' ? styles.goldShadow : styles.shadow,
        style,
      ]}
    >
      {kind === 'gold' || kind === 'skr' ? (
        <LinearGradient colors={kind === 'gold' ? ['#ffd65c', COLORS.gold2] : ['#dcff9e', '#9fd65a']} style={[StyleSheet.absoluteFill, { borderRadius: small ? 12 : 18 }]} />
      ) : null}
      {inner}
    </Pressable>
  );
}

export function Pill({ text, color = COLORS.card2, fg = COLORS.text }: { text: string; color?: string; fg?: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: color }]}>
      <T v="bold" style={{ fontSize: 11, color: fg }}>
        {text}
      </T>
    </View>
  );
}

export function Bar({ pct, colors = [COLORS.gold2, COLORS.gold], height = 8 }: { pct: number; colors?: [string, string]; height?: number }) {
  return (
    <View style={{ height, borderRadius: height, backgroundColor: '#00000066', overflow: 'hidden' }}>
      <LinearGradient start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} colors={colors} style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  base: { color: COLORS.text, fontFamily: F.body, fontSize: 14 },
  bold: { fontFamily: F.bold },
  black: { fontFamily: F.black },
  display: { fontFamily: F.display, letterSpacing: 0.3 },
  muted: { color: COLORS.muted, fontSize: 12 },
  label: { color: COLORS.muted, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontFamily: F.bold },
  card: { backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 2, borderRadius: 18, padding: 14 },
  btn: {
    minHeight: 46,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card2,
    borderWidth: 2,
    borderColor: COLORS.line,
    overflow: 'hidden',
  },
  btnSmall: { minHeight: 34, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  ghost: { backgroundColor: 'transparent' },
  shadow: { shadowColor: '#000', shadowOpacity: 0.4, shadowOffset: { width: 0, height: 4 }, shadowRadius: 0, elevation: 4 },
  goldShadow: { shadowColor: '#a35400', shadowOpacity: 1, shadowOffset: { width: 0, height: 5 }, shadowRadius: 0, elevation: 6, borderColor: '#ffe08a' },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
});
