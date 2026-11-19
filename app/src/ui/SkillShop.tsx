/**
 * Skills: the Market's SKILLS tab (buy with NUGS, the in-game coin) and the Bag's three skill slots.
 * The moves themselves live in game/brawl2/sim.ts (SKILLS); names, colours and prices in game/brawl2/specials.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { SKILL_INFO, SKILL_ORDER, type SkillInfo } from '../game/brawl2/specials';
import type { SkillId } from '../game/brawl2/sim';
import { play } from '../game/sfx';
import { SLOT_NAMES, useSkills } from '../game/skills';
import { useGame } from '../game/store';
import { T, U } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { alpha, Corners, TECH, TechBtn, TechPanel } from './tech';

const ICON: Record<SkillId, PixName> = {
  moon: 'jump', rush: 'bolt', quake: 'pick', whirl: 'sparkle', dive: 'fire', guard: 'gem',
  grab: 'fist', magnet: 'keys', dynamite: 'fire', geyser: 'wave', cavein: 'cave', tunnel: 'mole',
};
/** how each kind of skill moves in its preview: a lift, a dash, a shake, a spin, a drop or a pulse */
type Motion = 'up' | 'dash' | 'shake' | 'spin' | 'drop' | 'pulse';
const MOTION: Record<SkillId, Motion> = {
  moon: 'up', rush: 'dash', quake: 'shake', whirl: 'spin', dive: 'drop', guard: 'pulse',
  grab: 'dash', magnet: 'dash', dynamite: 'up', geyser: 'up', cavein: 'drop', tunnel: 'pulse',
};

/** The NUGS balance, with what they are. */
export function NugsBadge() {
  const nugs = useSkills((s) => s.nugs);
  return (
    <View style={styles.nugs}>
      <PixIcon name="gem" size={16} />
      <T v="display" style={{ fontSize: 18, color: COLORS.gold }}>{nugs === null ? '…' : nugs.toLocaleString()}</T>
      <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>NUGS</T>
    </View>
  );
}

/** A skill's icon, moving the way the skill does, in a 2 second loop. */
function SkillGlyph({ k, size = 44 }: { k: SkillId; size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 2000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const info = SKILL_INFO[k];
  const mo = MOTION[k];
  const ph = (pts: number[]) => t.interpolate({ inputRange: pts.map((_, i) => i / (pts.length - 1)), outputRange: pts });
  const transform =
    mo === 'up' ? [{ translateY: ph([0, 0, -12, -14, 0, 0]) }]
    : mo === 'dash' ? [{ translateX: ph([-10, -10, 12, 12, -10, -10]) }]
    : mo === 'shake' ? [{ translateX: ph([0, -3, 3, -3, 3, 0, 0, 0]) }]
    : mo === 'spin' ? [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }]
    : mo === 'drop' ? [{ translateY: ph([-12, -12, 10, 8, 10, -12]) }]
    : [{ scale: ph([1, 1.25, 1, 1.25, 1]) }];
  return (
    <View style={[styles.glyph, { width: size + 20, height: size + 20, backgroundColor: alpha(info.color, 0.14), borderColor: alpha(info.color, 0.5) }]}>
      <Animated.View style={{ transform }}>
        <PixIcon name={ICON[k]} size={size} />
      </Animated.View>
    </View>
  );
}

/** The Market's SKILLS tab. */
export function SkillsMarket({ wide, bottomPad }: { wide: boolean; bottomPad: number }) {
  const owner = useGame((s) => s.wallet.owner);
  const refresh = useSkills((s) => s.refresh);
  useEffect(() => {
    if (owner) void refresh();
  }, [owner, refresh]);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: wide ? 16 : 12, paddingTop: 6, paddingBottom: bottomPad, gap: 12 }}>
      <View style={styles.intro}>
        <PixIcon name="fist" size={22} />
        <T style={{ flex: 1, fontSize: 13, lineHeight: 18, color: TECH.dim }}>
          Skills for the Fight Club: put three in your Bag and use them with SKILL (U or Q), SKILL + side and SKILL + down. Every skill is as strong as the others; they just play differently. They open arena powers too.
        </T>
        <NugsBadge />
      </View>
      <T v="tiny" style={{ color: TECH.dim }}>
        NUGS are Gali's in-game coin: 1 for every 10 XP you earn. Spending them never lowers your XP or level. They are not crypto and can't be bought or sold.
      </T>
      <View style={styles.grid}>
        {SKILL_ORDER.map((k) => (
          <SkillCard key={k} info={SKILL_INFO[k]} wide={wide} />
        ))}
      </View>
    </ScrollView>
  );
}

function SkillCard({ info, wide }: { info: SkillInfo; wide: boolean }) {
  const k = info.id;
  const has = useSkills((s) => s.has(k));
  const nugs = useSkills((s) => s.nugs);
  const loadout = useSkills((s) => s.loadout);
  const toast = useGame((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const slot = loadout.indexOf(k);
  const buy = async () => {
    setBusy(true);
    const err = await useSkills.getState().buy(k);
    setBusy(false);
    if (err) toast(err, 'bad');
    else {
      play('select');
      toast(`${info.name} is yours. Put it in a slot below.`, 'good');
    }
  };
  return (
    <View style={[styles.card, { width: wide ? '32%' : '100%', borderColor: has ? alpha(info.color, 0.55) : TECH.rule }]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <SkillGlyph k={k} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="display" style={{ fontSize: 20, color: info.color }}>{info.name}</T>
          <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>{info.kind}{info.price === 0 ? ' · FREE' : ''}</T>
        </View>
      </View>
      <T style={{ fontSize: 13, lineHeight: 18 }}>{info.line}</T>
      <T v="muted" style={{ fontSize: 12 }}>Best: {info.how.toLowerCase()}.</T>
      {has ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <T v="tiny" style={{ color: COLORS.green, letterSpacing: 1 }}>{slot >= 0 ? `IN ${SLOT_NAMES[slot]}` : 'OWNED'}</T>
          <View style={{ flex: 1 }} />
          {[0, 1, 2].map((j) => (
            <TechBtn key={j} small label={['N', 'SIDE', 'DOWN'][j]} primary={slot === j} color={info.color} onPress={() => useSkills.getState().equip(j, slot === j ? null : k)} />
          ))}
        </View>
      ) : (
        <TechBtn
          label={busy ? 'BUYING…' : `BUY · ${info.price.toLocaleString()} NUGS`}
          primary
          color={info.color}
          disabled={busy || (nugs !== null && nugs < info.price)}
          onPress={() => void buy()}
        />
      )}
      {slot >= 0 ? <Corners color={info.color} size={8} /> : null}
    </View>
  );
}

/** The Bag's three skill slots: tap a slot, then a skill you own. */
export function BagSkills() {
  const loadout = useSkills((s) => s.loadout);
  const owned = useSkills((s) => s.owned);
  const refresh = useSkills((s) => s.refresh);
  const owner = useGame((s) => s.wallet.owner);
  const [pick, setPick] = useState<number | null>(null);
  useEffect(() => {
    if (owner) void refresh();
  }, [owner, refresh]);
  const mine = SKILL_ORDER.filter((k) => SKILL_INFO[k].price === 0 || owned.includes(k));
  return (
    <TechPanel title="FIGHT CLUB SKILLS" color={COLORS.gold} right={<NugsBadge />}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((j) => {
          const k = loadout[j];
          const info = k ? SKILL_INFO[k] : null;
          return (
            <Pressable key={j} onPress={() => setPick(pick === j ? null : j)} style={[styles.slot, { borderColor: pick === j ? COLORS.gold : info ? alpha(info.color, 0.6) : TECH.rule }]} accessibilityRole="button" accessibilityLabel={`${SLOT_NAMES[j]}: ${info?.name ?? 'empty'}`}>
              <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>{SLOT_NAMES[j]}</T>
              {k ? <SkillGlyph k={k} size={28} /> : <View style={[styles.glyph, { width: 48, height: 48, borderStyle: 'dashed', borderColor: TECH.rule }]} />}
              <T v="display" style={{ fontSize: 14, color: info?.color ?? TECH.dim, textAlign: 'center' }} numberOfLines={1}>{info?.name ?? 'EMPTY'}</T>
            </Pressable>
          );
        })}
      </View>
      {pick !== null ? (
        <View style={{ gap: 6, marginTop: 8 }}>
          <T v="tiny" style={{ color: COLORS.gold, letterSpacing: 1 }}>PICK A SKILL FOR {SLOT_NAMES[pick]}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {mine.map((k) => (
              <TechBtn
                key={k}
                small
                label={SKILL_INFO[k].name}
                color={SKILL_INFO[k].color}
                primary={loadout[pick] === k}
                onPress={() => {
                  useSkills.getState().equip(pick, k);
                  setPick(null);
                }}
              />
            ))}
            <TechBtn small label="EMPTY" onPress={() => { useSkills.getState().equip(pick, null); setPick(null); }} />
          </View>
          <T v="muted" style={{ fontSize: 11 }}>More skills in the Market, bought with NUGS.</T>
        </View>
      ) : (
        <T v="muted" style={{ fontSize: 11, marginTop: 6 }}>In the Fight Club: U or Q (or the SKILL button), with side or down for the other two. Each has its own cooldown.</T>
      )}
    </TechPanel>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderWidth: U, borderColor: TECH.rule, backgroundColor: TECH.panel },
  nugs: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: U, borderColor: alpha(COLORS.gold, 0.5), backgroundColor: alpha(COLORS.gold, 0.08) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { padding: 10, gap: 8, borderWidth: U, backgroundColor: TECH.panel },
  glyph: { alignItems: 'center', justifyContent: 'center', borderWidth: U },
  slot: { flex: 1, alignItems: 'center', gap: 5, padding: 8, borderWidth: U, backgroundColor: TECH.panel },
});
