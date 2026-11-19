/**
 * Skills: the Market's SKILLS tab (watch and buy with NUGS, the in-game coin) and the three skill slots (Profile, and
 * before each Fight Club fight).
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
import { atlasSource } from '../pixel/atlasSource';
import SkillDemoView from '../pixel/SkillDemoView';
import { useMarket } from '../game/market';

export const SKILL_ICON: Record<SkillId, PixName> = {
  moon: 'jump', rush: 'bolt', quake: 'pick', whirl: 'sparkle', dive: 'fire', guard: 'gem',
  grab: 'fist', magnet: 'keys', dynamite: 'fire', geyser: 'wave', cavein: 'cave', tunnel: 'mole',
  slide: 'cart', boomerang: 'pick', sonar: 'sound', boulder: 'planet', meteor: 'firefly', drill: 'bolt',
  inferno: 'fire', jade: 'sparkle', taiji: 'eye', thunder: 'bolt', pillar: 'star',
};
/** how each kind of skill moves in its preview: a lift, a dash, a shake, a spin, a drop or a pulse */
type Motion = 'up' | 'dash' | 'shake' | 'spin' | 'drop' | 'pulse';
const MOTION: Record<SkillId, Motion> = {
  moon: 'up', rush: 'dash', quake: 'shake', whirl: 'spin', dive: 'drop', guard: 'pulse',
  grab: 'dash', magnet: 'dash', dynamite: 'up', geyser: 'up', cavein: 'drop', tunnel: 'pulse',
  slide: 'dash', boomerang: 'spin', sonar: 'pulse', boulder: 'spin', meteor: 'drop', drill: 'dash',
  inferno: 'dash', jade: 'spin', taiji: 'pulse', thunder: 'shake', pillar: 'drop',
};

/** The NUGS balance, with what they are. */
export function NugsBadge() {
  const nugs = useSkills((s) => s.nugs);
  return (
    <View style={styles.nugs}>
      <PixIcon name="nugs" size={16} />
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
        <PixIcon name={SKILL_ICON[k]} size={size} />
      </Animated.View>
    </View>
  );
}

/** The Market's SKILLS tab: watch each skill in a real fight, buy it with NUGS. Picking your three is in Profile and before a fight. */
export function SkillsMarket({ wide, bottomPad }: { wide: boolean; bottomPad: number }) {
  const owner = useGame((s) => s.wallet.owner);
  const refresh = useSkills((s) => s.refresh);
  const [sel, setSel] = useState<SkillId>(SKILL_ORDER[0]);
  useEffect(() => {
    if (owner) void refresh();
  }, [owner, refresh]);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: wide ? 16 : 12, paddingTop: 6, paddingBottom: bottomPad, gap: 12 }}>
      <View style={styles.intro}>
        <PixIcon name="fist" size={22} />
        <T style={{ flex: 1, fontSize: 13, lineHeight: 18, color: TECH.dim }}>
          Tap a skill to watch it. Six are free; the rest cost NUGS, 1 for every 10 XP you earn. Pick your three in Profile or before a fight.
        </T>
        <NugsBadge />
      </View>
      <SkillStage k={sel} wide={wide} />
      <View style={styles.grid}>
        {SKILL_ORDER.map((k) => (
          <SkillTile key={k} k={k} on={sel === k} wide={wide} onPress={() => setSel(k)} />
        ))}
      </View>
      <T v="tiny" style={{ color: TECH.dim }}>
        Fight Club: Q or U, with A / D or S for your other two. Lobby and ORE Island: Q, R, X on the bottom bar. Each waits 7 seconds after use. NUGS are not crypto and can't be bought or sold.
      </T>
    </ScrollView>
  );
}

/** The selected skill, playing on loop in the fight engine, with what it does and its price. */
function SkillStage({ k, wide }: { k: SkillId; wide: boolean }) {
  const info = SKILL_INFO[k];
  const has = useSkills((s) => s.has(k));
  const nugs = useSkills((s) => s.nugs);
  const toast = useGame((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [atlas, setAtlas] = useState<string | null>(null);
  useEffect(() => {
    atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, []);
  const buy = async () => {
    setBusy(true);
    const err = await useSkills.getState().buy(k);
    setBusy(false);
    if (err) toast(err, 'bad');
    else {
      play('select');
      toast(`${info.name} is yours. Put it in a slot in Profile or before a fight.`, 'good');
    }
  };
  const short = nugs !== null && nugs < info.price;
  return (
    <View style={[styles.stage, { flexDirection: wide ? 'row' : 'column', borderColor: alpha(info.color, 0.6) }]}>
      <View style={[styles.demo, wide ? { flex: 1.3 } : { height: 200 }]}>
        {atlas ? <SkillDemoView atlas={atlas} skill={k} dom={{ style: { flex: 1 }, scrollEnabled: false }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 8, padding: 12 }}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <SkillGlyph k={k} size={32} />
          <View style={{ flex: 1 }}>
            <T v="display" style={{ fontSize: 26, lineHeight: 28, color: info.color }}>{info.name}</T>
            <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>{info.kind}</T>
          </View>
        </View>
        <T style={{ fontSize: 14, lineHeight: 20 }}>{info.line}</T>
        <T v="muted" style={{ fontSize: 12 }}>Best: {info.how.toLowerCase()}.</T>
        <View style={{ flex: 1 }} />
        {has ? (
          <View style={[styles.owned, { borderColor: alpha(COLORS.green, 0.5) }]}>
            <PixIcon name="check" size={16} />
            <T v="display" style={{ fontSize: 16, color: COLORS.green }}>{info.price === 0 ? 'FREE · YOURS' : 'YOURS'}</T>
          </View>
        ) : (
          <>
            <TechBtn label={busy ? 'BUYING…' : `BUY · ${info.price.toLocaleString()} NUGS`} primary color={info.color} disabled={busy || short} onPress={() => void buy()} />
            {short ? <T v="tiny" style={{ color: TECH.dim }}>{(info.price - (nugs ?? 0)).toLocaleString()} NUGS to go: about {Math.ceil((info.price - (nugs ?? 0)) * 10).toLocaleString()} XP.</T> : null}
          </>
        )}
      </View>
    </View>
  );
}

function SkillTile({ k, on, wide, onPress }: { k: SkillId; on: boolean; wide: boolean; onPress: () => void }) {
  const info = SKILL_INFO[k];
  const has = useSkills((s) => s.has(k));
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${info.name}, ${has ? 'yours' : `${info.price} NUGS`}`} style={[styles.tile, { width: wide ? '15.5%' : '31%', borderColor: on ? info.color : has ? alpha(info.color, 0.45) : TECH.rule, backgroundColor: on ? alpha(info.color, 0.12) : TECH.panel }]}>
      <SkillGlyph k={k} size={28} />
      <T v="display" numberOfLines={1} style={{ fontSize: 13, color: on ? info.color : COLORS.text, textAlign: 'center' }}>{info.name}</T>
      <T v="tiny" style={{ color: has ? COLORS.green : COLORS.gold, letterSpacing: 1 }}>{has ? (info.price === 0 ? 'FREE' : 'YOURS') : `${info.price.toLocaleString()} NUGS`}</T>
      {on ? <Corners color={info.color} size={6} /> : null}
    </Pressable>
  );
}

/**
 * Your three skills (Profile, and before every Fight Club fight): tap a slot, then a skill you own.
 * `compact` drops the NUGS badge and the help line, for the pre-fight picker.
 */
export function SkillLoadout({ title = 'FIGHT CLUB SKILLS', compact = false }: { title?: string; compact?: boolean }) {
  const loadout = useSkills((s) => s.loadout);
  const owned = useSkills((s) => s.owned);
  const refresh = useSkills((s) => s.refresh);
  const owner = useGame((s) => s.wallet.owner);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    if (owner) void refresh();
  }, [owner, refresh]);
  const mine = SKILL_ORDER.filter((k) => SKILL_INFO[k].price === 0 || owned.includes(k));
  return (
    <TechPanel title={title} color={COLORS.gold} right={compact ? undefined : <NugsBadge />}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((j) => {
          const k = loadout[j];
          const info = k ? SKILL_INFO[k] : null;
          return (
            <Pressable key={j} onPress={() => setPick(j)} style={[styles.slot, { borderColor: pick === j ? COLORS.gold : info ? alpha(info.color, 0.6) : TECH.rule, backgroundColor: pick === j ? alpha(COLORS.gold, 0.1) : TECH.panel }]} accessibilityRole="button" accessibilityLabel={`${SLOT_NAMES[j]}: ${info?.name ?? 'empty'}`}>
              <T v="tiny" style={{ color: pick === j ? COLORS.gold : TECH.dim, letterSpacing: 1 }}>{SLOT_NAMES[j]}</T>
              {k ? <SkillGlyph k={k} size={26} /> : <View style={[styles.glyph, { width: 46, height: 46, borderStyle: 'dashed', borderColor: TECH.rule }]} />}
              <T v="display" style={{ fontSize: 13, color: info?.color ?? TECH.dim, textAlign: 'center' }} numberOfLines={1}>{info?.name ?? 'EMPTY'}</T>
            </Pressable>
          );
        })}
      </View>
      <T v="tiny" style={{ color: COLORS.gold, letterSpacing: 1, marginTop: 8 }}>TAP A SKILL FOR {SLOT_NAMES[pick]}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {mine.map((k) => {
          const info = SKILL_INFO[k];
          const at = loadout.indexOf(k);
          return (
            <Pressable
              key={k}
              onPress={() => {
                useSkills.getState().equip(pick, k);
                setPick((p) => (p + 1) % 3);
              }}
              accessibilityRole="button"
              accessibilityLabel={`${info.name}${at >= 0 ? `, in ${SLOT_NAMES[at]}` : ''}`}
              style={[styles.chip, { borderColor: at >= 0 ? info.color : TECH.rule, backgroundColor: at >= 0 ? alpha(info.color, 0.14) : 'transparent' }]}
            >
              <PixIcon name={SKILL_ICON[k]} size={16} />
              <T v="display" style={{ fontSize: 13, color: at >= 0 ? info.color : COLORS.text }}>{info.name}</T>
            </Pressable>
          );
        })}
      </View>
      {compact ? null : (
        <Pressable onPress={() => useMarket.getState().show(undefined, 'skills')} accessibilityRole="button" style={{ marginTop: 8 }}>
          <T v="tiny" style={{ color: COLORS.gold, textDecorationLine: 'underline' }}>SEE ALL SKILLS IN THE MARKET</T>
        </Pressable>
      )}
    </TechPanel>
  );
}

const styles = StyleSheet.create({
  intro: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderWidth: U, borderColor: TECH.rule, backgroundColor: TECH.panel },
  howTo: { gap: 6, padding: 10, borderWidth: U, borderColor: alpha(COLORS.gold, 0.45), backgroundColor: alpha(COLORS.gold, 0.06) },
  nugs: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderWidth: U, borderColor: alpha(COLORS.gold, 0.5), backgroundColor: alpha(COLORS.gold, 0.08) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: { padding: 10, gap: 8, borderWidth: U, backgroundColor: TECH.panel },
  glyph: { alignItems: 'center', justifyContent: 'center', borderWidth: U },
  stage: { borderWidth: U, backgroundColor: TECH.panel, overflow: 'hidden', minHeight: 230 },
  demo: { backgroundColor: '#0b0712', minHeight: 200 },
  owned: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderWidth: U },
  tile: { alignItems: 'center', gap: 4, padding: 8, borderWidth: U },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderWidth: U },
  slot: { flex: 1, alignItems: 'center', gap: 5, padding: 8, borderWidth: U, backgroundColor: TECH.panel },
});
