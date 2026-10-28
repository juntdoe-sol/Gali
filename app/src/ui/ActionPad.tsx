/**
 * Round game buttons for touch screens: the arena's skill wheel uses them, and the landscape app's lobby
 * and island get a HIT and JUMP pad bottom right. They fire on touch-down. On Android, given a `zone`,
 * the game itself catches the finger (ui/zones.tsx), so they work while another finger holds the stick.
 */
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { COLORS } from '../game/constants';
import { haptic } from '../game/sfx';
import { T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { TouchZone, ZONES_ON, type ZoneGroup } from './zones';

export /** One round (phone) or square (PC) fight button, with a cooldown that drains from the top. */
function SkillButton({ size, round, icon, label, kbd, left = 0, total = 1, locked, count, gold, style, onPress, zone }: { size: number; round: boolean; icon: PixName; label?: string; kbd?: string; left?: number; total?: number; locked?: string; count?: number; gold?: boolean; style?: ViewStyle; onPress: () => void; zone?: ZoneGroup }) {
  const cooling = left > 0;
  const frac = Math.max(0, Math.min(1, left / total));
  const face = (pressed: boolean) => (
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
  );
  // Android, in a game: the game hears the finger and presses this (ui/zones.tsx), so it works mid-walk
  if (ZONES_ON && zone) {
    return (
      <TouchZone group={zone} off={Boolean(locked)} style={style} onPress={onPress}>
        {face}
      </TouchZone>
    );
  }
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
      {({ pressed }) => face(pressed)}
    </Pressable>
  );
}

/** HIT (big) and JUMP, bottom right. `small` keeps the island's map clear. */
export function FightPad({ bottom, right, onHit, onJump, hit = true, small, zone, ride }: { bottom: number; right: number; onHit: () => void; onJump: () => void; hit?: boolean; small?: boolean; zone?: ZoneGroup; ride?: { label: string; on: boolean; onPress: () => void } | null }) {
  const H = small ? 62 : 80;
  const J = small ? 46 : 56;
  return (
    <View style={{ position: 'absolute', right, bottom, width: H + J * 2 + 18, height: H + J / 2 + 6 }} pointerEvents="box-none">
      {ride ? <SkillButton size={J} round gold={ride.on} icon="cart" label={ride.label} zone={zone} style={{ position: 'absolute', right: (hit ? H : 0) + J + 12, bottom: 0 }} onPress={ride.onPress} /> : null}
      {hit ? <SkillButton size={H} round gold icon="fist" label="HIT" zone={zone} style={{ position: 'absolute', right: 0, bottom: 0 }} onPress={onHit} /> : null}
      <SkillButton size={J} round icon="jump" label="JUMP" zone={zone} style={{ position: 'absolute', right: hit ? H + 6 : 0, bottom: hit ? H / 2 + 2 : 0 }} onPress={onJump} />
    </View>
  );
}

const styles = StyleSheet.create({
  skill: { borderWidth: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 18, paddingHorizontal: 3, borderRadius: 9, alignItems: 'center' },
  key: { position: 'absolute', left: 2, top: 2, paddingHorizontal: 3, borderRadius: 3, backgroundColor: '#f2f5ff' },
});
