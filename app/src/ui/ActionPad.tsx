/**
 * Round game buttons for touch screens: the arena's skill wheel uses them, and the landscape app's lobby
 * and island get a HIT and JUMP pad bottom right. They fire on touch-down, so they work while another
 * finger holds the stick.
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { haptic } from '../game/sfx';
import { T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

export /** One round (phone) or square (PC) fight button, with a cooldown that drains from the top. */
function SkillButton({ size, round, icon, label, kbd, left = 0, total = 1, locked, count, gold, style, onPress }: { size: number; round: boolean; icon: PixName; label?: string; kbd?: string; left?: number; total?: number; locked?: string; count?: number; gold?: boolean; style?: ViewStyle; onPress: () => void }) {
  const cooling = left > 0;
  const frac = Math.max(0, Math.min(1, left / total));
  return (
    <Pressable
      disabled={Boolean(locked)}
      onPressIn={() => {
        haptic.tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={locked ? `${label ?? icon}, ${locked}` : label ?? icon}
      style={style}
    >
      {({ pressed }) => (
        <View
          style={[
            styles.skill,
            { width: size, height: size, borderRadius: round ? size / 2 : 6, borderColor: gold ? '#ffffff' : locked ? '#33406a' : COLORS.gold, backgroundColor: gold ? COLORS.gold : 'rgba(8,13,32,0.82)', opacity: locked ? 0.45 : 1, transform: [{ scale: pressed ? 0.92 : 1 }] },
          ]}
        >
          <PixIcon name={locked ? 'lock' : icon} size={Math.round(size * 0.42)} />
          {label && size >= 52 ? (
            <T v="display" numberOfLines={1} style={{ fontSize: size >= 80 ? 18 : 12, lineHeight: size >= 80 ? 19 : 13, color: gold ? '#070d20' : COLORS.gold }}>
              {locked ?? label}
            </T>
          ) : null}
          {cooling ? (
            <View style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]} pointerEvents="none">
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${frac * 100}%`, backgroundColor: 'rgba(4,6,15,0.72)' }} />
              <T v="display" style={{ fontSize: size >= 52 ? 22 : 18, color: '#ffffff', textShadowColor: '#000', textShadowRadius: 0, textShadowOffset: { width: 1, height: 1 } }}>
                {Math.ceil(left / 1000)}
              </T>
            </View>
          ) : null}
          {count !== undefined ? (
            <View style={[styles.badge, { backgroundColor: count ? COLORS.gold : '#5a6a8a' }]} pointerEvents="none">
              <T v="display" style={{ fontSize: 13, lineHeight: 14, color: '#070d20' }}>
                {count}
              </T>
            </View>
          ) : null}
          {kbd ? (
            <View style={styles.key} pointerEvents="none">
              <T v="display" style={{ fontSize: 11, lineHeight: 12, color: '#070d20' }}>
                {kbd}
              </T>
            </View>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** HIT (big) and JUMP, bottom right. */
export function FightPad({ bottom, right, onHit, onJump, hit = true }: { bottom: number; right: number; onHit: () => void; onJump: () => void; hit?: boolean }) {
  return (
    <View style={{ position: 'absolute', right, bottom, width: 150, height: 120 }} pointerEvents="box-none">
      {hit ? <SkillButton size={80} round gold icon="fist" label="HIT" style={{ position: 'absolute', right: 0, bottom: 0 }} onPress={onHit} /> : null}
      <SkillButton size={56} round icon="jump" label="JUMP" style={{ position: 'absolute', right: hit ? 88 : 0, bottom: hit ? 44 : 0 }} onPress={onJump} />
    </View>
  );
}

const styles = StyleSheet.create({
  skill: { borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, paddingHorizontal: 3, borderRadius: 9, alignItems: 'center' },
  key: { position: 'absolute', left: 2, top: 2, paddingHorizontal: 3, borderRadius: 3, backgroundColor: '#f2f5ff' },
});
