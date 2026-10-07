/**
 * The dig game's screen: a rock wall inside a spot's mine.
 *
 * Tap a rock and your pickaxe swings at it: the block shakes, chips fly, cracks
 * spread, and when it breaks whatever was behind it pops out. Find the gem and the
 * wall drops away to the next one down. All of it is drawn from the pixel sprites in
 * assets/dig (scripts/dig-art.py) and moved with Animated, so it runs the same on
 * Android and web. Opened from a spot's mine ("Dig here") or the Dig button on the map.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, levelFromXp, xpForLevel } from '../game/constants';
import { DAILY_SWINGS, DIG_COLS, gemFound, ROUND_SWINGS, XP_GEM, XP_NUGGET, XP_ROCK, type Find, type Tile } from '../game/dig';
import { useDig } from '../game/digStore';
import { useGame, useLevelXp } from '../game/store';
import { useView } from '../pixel/view';
import { GEAR_ICON } from './gearIcons';
import { Bar, Btn, T } from './kit';
import { BAR_H } from './TabBar';

const NATIVE = Platform.OS !== 'web';
const PIXEL = { dataSet: { pixelart: '1' } } as object;

const ART = {
  rock: {
    1: require('../../assets/dig/rock-1.png'),
    2: require('../../assets/dig/rock-2.png'),
    3: require('../../assets/dig/rock-3.png'),
  } as Record<number, ImageSourcePropType>,
  crack1: require('../../assets/dig/crack-1.png') as ImageSourcePropType,
  crack2: require('../../assets/dig/crack-2.png') as ImageSourcePropType,
  hole: require('../../assets/dig/hole.png') as ImageSourcePropType,
  spark: require('../../assets/dig/spark.png') as ImageSourcePropType,
  find: {
    gem: require('../../assets/dig/gem.png'),
    nugget: require('../../assets/dig/nugget.png'),
    rock: require('../../assets/dig/pebbles.png'),
  } as Record<Find, ImageSourcePropType>,
};
/** Chip colours per rock hardness, for the debris that flies off a hit. */
const CHIPS: Record<number, string[]> = {
  1: ['#b88a5c', '#8a6644', '#5c4129'],
  2: ['#98a2b8', '#6b7388', '#454c5e'],
  3: ['#5f6a96', '#3b4263', '#232843'],
};
const ROCK_NAME: Record<number, string> = { 1: 'soft rock', 2: 'stone', 3: 'hard rock' };
const FIND_XP: Record<Find, number> = { gem: XP_GEM, nugget: XP_NUGGET, rock: XP_ROCK };
const FIND_COLOR: Record<Find, string> = { gem: COLORS.teal, nugget: COLORS.gold, rock: COLORS.muted };

const usePickaxe = () => useGame((s) => GEAR_ICON[s.save.pickaxe] ?? GEAR_ICON['pick-wood']);

/** The spot a dig from the map should open: the one you are mining, else one you picked, else the last wall. */
function homeSpot(): number {
  const g = useGame.getState();
  if (g.pending) {
    for (let i = 0; i < 25; i++) if (g.pending.mask & (1 << i)) return i;
  }
  if (g.selected.length) return g.selected[0];
  return useDig.getState().dig.wall?.spot ?? 0;
}

/** The Dig button on the map. Hidden while a panel or a spot's mine has the screen. */
export function DigEntry() {
  const insets = useSafeAreaInsets();
  const dockOpen = useGame((s) => s.dockOpen);
  const inside = useView((s) => s.focus >= 0);
  const swings = useDig((s) => s.dig.swings);
  const pick = usePickaxe();
  if (dockOpen || inside) return null;
  return (
    <Pressable
      onPress={() => useDig.getState().show(homeSpot())}
      style={({ pressed }) => [styles.entry, { bottom: insets.bottom + BAR_H + 46 }, pressed && { transform: [{ scale: 0.95 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Dig for XP. ${swings} swings left`}
    >
      <Image source={pick} style={{ width: 26, height: 26 }} {...PIXEL} />
      <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
        DIG
      </T>
      <View style={styles.entryCount}>
        <T v="black" style={{ fontSize: 11, color: '#070d20' }}>
          {swings}
        </T>
      </View>
    </Pressable>
  );
}

const anim = (v: Animated.Value, toValue: number, duration: number, easing = Easing.out(Easing.quad)) =>
  Animated.timing(v, { toValue, duration, easing, useNativeDriver: NATIVE });

/** Where each chip of debris lands, as a fraction of the tile's size. Fixed, so a hit always looks the same. */
const DEBRIS = [
  { x: -0.55, y: -0.5, r: -140 },
  { x: 0.6, y: -0.4, r: 160 },
  { x: -0.35, y: 0.55, r: -90 },
  { x: 0.4, y: 0.6, r: 120 },
  { x: 0.05, y: -0.7, r: 200 },
  { x: -0.7, y: 0.1, r: -220 },
];

function RockTile({ tile, index, locked, size, pick }: { tile: Tile; index: number; locked: boolean; size: number; pick: ImageSourcePropType }) {
  const broken = tile.hp === 0;
  const prev = useRef(tile.hp);
  const shake = useRef(new Animated.Value(0)).current;
  const punch = useRef(new Animated.Value(1)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const swing = useRef(new Animated.Value(0)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(broken ? 1 : 0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (tile.hp >= prev.current) {
      prev.current = tile.hp;
      return;
    }
    prev.current = tile.hp;
    // the pickaxe comes down, the block jolts, chips fly
    swing.setValue(0);
    burst.setValue(0);
    flash.setValue(0.85);
    Animated.parallel([
      anim(swing, 1, 190, Easing.in(Easing.quad)),
      Animated.sequence([anim(shake, 1, 40), anim(shake, -1, 60), anim(shake, 0.6, 50), anim(shake, 0, 50)]),
      Animated.sequence([anim(punch, 0.88, 60), Animated.spring(punch, { toValue: 1, friction: 4, tension: 180, useNativeDriver: NATIVE })]),
      anim(flash, 0, 220),
      anim(burst, 1, 420),
    ]).start();
    if (tile.hp === 0) {
      rise.setValue(0);
      Animated.parallel([
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: NATIVE }),
        anim(rise, 1, 900),
      ]).start();
    }
  }, [tile.hp, swing, burst, flash, shake, punch, pop, rise]);

  // the gem keeps twinkling once it is out
  useEffect(() => {
    if (!broken || tile.find !== 'gem') return;
    const loop = Animated.loop(Animated.sequence([anim(glow, 1, 700, Easing.inOut(Easing.quad)), anim(glow, 0, 700, Easing.inOut(Easing.quad))]));
    loop.start();
    return () => loop.stop();
  }, [broken, tile.find, glow]);

  const label = broken
    ? `Rock ${index + 1}, broken, ${tile.find === 'rock' ? 'plain rock' : tile.find}`
    : `Rock ${index + 1}, ${ROCK_NAME[tile.max]}, ${tile.hp} hit${tile.hp > 1 ? 's' : ''} left`;
  const damage = tile.max - tile.hp;
  const chips = CHIPS[tile.max];
  return (
    <Pressable
      onPress={() => useDig.getState().swing(index)}
      disabled={broken || locked}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: size, height: size }}
    >
      <Animated.View
        style={{
          flex: 1,
          transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.06, size * 0.06] }) }, { scale: punch }],
        }}
      >
        <Image source={ART.hole} style={styles.fill} {...PIXEL} />
        {broken ? (
          <Animated.View style={[styles.fill, styles.centre, { transform: [{ scale: pop }] }]}>
            <Image source={ART.find[tile.find]} style={{ width: size * 0.92, height: size * 0.92 }} {...PIXEL} />
            {tile.find === 'gem' ? (
              <>
                <Animated.Image
                  source={ART.spark}
                  style={[styles.spark, { top: size * 0.08, left: size * 0.12, width: size * 0.3, height: size * 0.3, opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.1] }) }] }]}
                  {...PIXEL}
                />
                <Animated.Image
                  source={ART.spark}
                  style={[styles.spark, { bottom: size * 0.1, right: size * 0.1, width: size * 0.24, height: size * 0.24, opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.1] }), transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [1.1, 0.5] }) }] }]}
                  {...PIXEL}
                />
              </>
            ) : null}
          </Animated.View>
        ) : (
          <>
            <Image source={ART.rock[tile.max]} style={styles.fill} {...PIXEL} />
            {damage >= 1 ? <Image source={damage >= 2 ? ART.crack2 : ART.crack1} style={styles.fill} {...PIXEL} /> : null}
          </>
        )}
        <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: '#ffffff', borderRadius: size * 0.12, opacity: flash }]} />
      </Animated.View>
      {/* chips of rock thrown off by the hit */}
      {DEBRIS.map((d, k) => (
        <Animated.View
          key={k}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: size / 2 - 3,
            top: size / 2 - 3,
            width: k % 2 ? 6 : 8,
            height: k % 2 ? 6 : 8,
            backgroundColor: chips[k % chips.length],
            opacity: burst.interpolate({ inputRange: [0, 0.05, 0.7, 1], outputRange: [0, 1, 1, 0] }),
            transform: [
              { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, d.x * size] }) },
              { translateY: burst.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, d.y * size - size * 0.25, d.y * size + size * 0.35] }) },
              { rotate: burst.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${d.r}deg`] }) },
            ],
          }}
        />
      ))}
      {/* the pickaxe, swung from the top right */}
<View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>
      <Animated.Image
        source={pick}
        style={{
          position: 'absolute',
          right: -size * 0.18,
          top: -size * 0.3,
          width: size * 0.8,
          height: size * 0.8,
          opacity: swing.interpolate({ inputRange: [0, 0.1, 0.8, 1], outputRange: [0, 1, 1, 0] }),
          transform: [{ rotate: swing.interpolate({ inputRange: [0, 0.6, 1], outputRange: ['50deg', '-35deg', '-20deg'] }) }],
        }}
        {...PIXEL}
      />
      </View>
      {/* the XP floats up off a broken rock */}
      {broken ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.xpFloat,
            {
              opacity: rise.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.9] }) }],
            },
          ]}
        >
          <T v="display" style={{ fontSize: tile.find === 'rock' ? 16 : 22, color: FIND_COLOR[tile.find], textShadowColor: '#000', textShadowRadius: 4 }}>
            +{FIND_XP[tile.find]} XP
          </T>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

export function DigPanel() {
  const insets = useSafeAreaInsets();
  const open = useDig((s) => s.open);
  const ready = useDig((s) => s.ready);
  const dig = useDig((s) => s.dig);
  const last = useDig((s) => s.last);
  const pick = usePickaxe();
  const xp = useLevelXp();
  const [wallW, setWallW] = useState(0);
  const slide = useRef(new Animated.Value(0)).current;
  const banner = useRef(new Animated.Value(0)).current;
  const lantern = useRef(new Animated.Value(0)).current;
  const wall = dig.wall;
  const done = gemFound(wall);

  useEffect(() => {
    if (!open) return;
    const loop = Animated.loop(Animated.sequence([anim(lantern, 1, 1400, Easing.inOut(Easing.sin)), anim(lantern, 0, 1400, Easing.inOut(Easing.sin))]));
    loop.start();
    return () => loop.stop();
  }, [open, lantern]);
  // the gem banner drops in when the wall is beaten
  useEffect(() => {
    if (done) Animated.spring(banner, { toValue: 1, friction: 5, tension: 90, useNativeDriver: NATIVE }).start();
    else banner.setValue(0);
  }, [done, wall?.depth, banner]);

  if (!open) return null;
  const { close, goDeeper } = useDig.getState();
  const out = dig.swings <= 0;
  const lvl = levelFromXp(xp);
  const pct = ((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100;
  const gap = 6;
  const size = wallW ? Math.floor((wallW - gap * (DIG_COLS - 1)) / DIG_COLS) : 0;
  // going deeper: the beaten wall lifts away and the next one rises into place
  const descend = () => {
    anim(slide, -1, 260, Easing.in(Easing.quad)).start(() => {
      goDeeper();
      slide.setValue(1);
      anim(slide, 0, 320).start();
    });
  };
  let line = 'Tap a rock to swing your pickaxe';
  if (done) line = 'The next wall is deeper and harder';
  else if (out) line = `Out of swings. Mine a round for +${ROUND_SWINGS}`;
  else if (last && !last.found) line = 'Crack! Hit it again';
  else if (last?.found === 'gem') line = 'You found the gem!';
  else if (last?.found === 'nugget') line = 'Gold nugget!';
  return (
    <Modal transparent visible animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close the dig" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <LinearGradient colors={['#2a1b0c', '#141026', '#070d20']} style={[StyleSheet.absoluteFill, styles.sheetBg]} />
        {/* lantern light breathing over the rock face */}
        <Animated.View pointerEvents="none" style={[styles.lantern, { opacity: lantern.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.24] }) }]} />
        <View style={styles.beam} />
        <View style={styles.head}>
          <Image source={pick} style={{ width: 34, height: 34 }} {...PIXEL} />
          <View style={{ flex: 1 }}>
            <T v="display" style={{ fontSize: 24, lineHeight: 26, color: COLORS.gold }}>
              {wall ? `SPOT ${wall.spot + 1} MINE` : 'THE MINE'}
            </T>
            <T v="bold" style={{ fontSize: 11, letterSpacing: 1, color: COLORS.muted }}>
              FIND THE GEM TO GO DEEPER
            </T>
          </View>
          {wall ? (
            <View style={styles.plank} accessibilityLabel={`Depth ${wall.depth}`}>
              <T v="black" style={{ fontSize: 9, letterSpacing: 1, color: '#3a2400' }}>
                DEPTH
              </T>
              <T v="display" style={{ fontSize: 22, lineHeight: 22, color: '#3a2400' }}>
                {wall.depth}
              </T>
            </View>
          ) : null}
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <T v="display" style={{ fontSize: 20, color: COLORS.muted }}>
              ✕
            </T>
          </Pressable>
        </View>
        <View style={styles.hud}>
          <View style={styles.swings} accessibilityLabel={`${dig.swings} swings left`}>
            <Image source={pick} style={{ width: 22, height: 22 }} {...PIXEL} />
            <T v="display" style={{ fontSize: 24, lineHeight: 26, color: out ? COLORS.red : COLORS.text }}>
              {dig.swings}
            </T>
          </View>
          <View style={{ flex: 1 }} accessibilityLabel={`Miner level ${lvl}`}>
            <View style={styles.lvlRow}>
              <T v="black" style={{ fontSize: 11, letterSpacing: 1, color: COLORS.teal }}>
                LEVEL {lvl}
              </T>
              <T v="bold" style={{ fontSize: 11, color: COLORS.muted }}>
                +{dig.xpToday} XP today
              </T>
            </View>
            <Bar pct={pct} colors={[COLORS.teal, '#8ff5e6']} />
          </View>
        </View>
        <View style={styles.wallFrame}>
          <View onLayout={(e) => setWallW(e.nativeEvent.layout.width)} style={{ overflow: 'hidden' }}>
            <Animated.View
              style={{
                gap,
                minHeight: size ? size * 4 + gap * 3 : 200,
                opacity: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
                transform: [{ translateY: slide.interpolate({ inputRange: [-1, 0, 1], outputRange: [-(size || 60) * 2, 0, (size || 60) * 2] }) }],
              }}
            >
              {ready && wall && size
                ? Array.from({ length: Math.ceil(wall.tiles.length / DIG_COLS) }, (_, row) => (
                    <View key={`${wall.depth}-${row}`} style={{ flexDirection: 'row', gap }}>
                      {wall.tiles.slice(row * DIG_COLS, (row + 1) * DIG_COLS).map((t, k) => (
                        <RockTile key={`${wall.spot}-${wall.depth}-${row * DIG_COLS + k}`} tile={t} index={row * DIG_COLS + k} locked={done || out} size={size} pick={pick} />
                      ))}
                    </View>
                  ))
                : null}
            </Animated.View>
          </View>
          {done ? (
            <Animated.View pointerEvents="none" style={[styles.banner, { opacity: banner, transform: [{ scale: banner.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }, { rotate: '-4deg' }] }]}>
              <T v="display" style={styles.bannerText}>
                GEM FOUND!
              </T>
            </Animated.View>
          ) : null}
        </View>
        <View accessibilityLiveRegion="polite" style={{ minHeight: 22 }}>
          <T v="bold" style={{ textAlign: 'center', color: done || last?.found === 'gem' ? COLORS.teal : last?.found === 'nugget' ? COLORS.gold : out ? COLORS.red : COLORS.text }}>
            {line}
          </T>
        </View>
        {done ? <Btn kind="gold" label={`GO DEEPER · DEPTH ${(wall?.depth ?? 1) + 1}`} onPress={descend} disabled={out} /> : null}
        <T v="muted" style={styles.note}>
          {DAILY_SWINGS} free swings a day, +{ROUND_SWINGS} for every round you mine. XP levels up your miner: no cash value, no effect on your odds.
        </T>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  entry: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 8,
    paddingRight: 8,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#070d20e6',
    borderWidth: 1.5,
    borderColor: COLORS.gold2,
  },
  entryCount: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: COLORS.gold, alignItems: 'center', justifyContent: 'center' },
  scrim: { flex: 1, backgroundColor: '#040817aa' },
  sheet: { paddingHorizontal: 16, paddingTop: 18, gap: 10, width: '100%', maxWidth: 520, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' },
  sheetBg: { borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  lantern: { position: 'absolute', top: -120, alignSelf: 'center', width: 420, height: 420, borderRadius: 210, backgroundColor: '#ffb84d' },
  beam: { position: 'absolute', top: 0, left: 0, right: 0, height: 8, backgroundColor: '#6b4423', borderBottomWidth: 2, borderColor: '#3a2410' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  plank: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: COLORS.gold, borderWidth: 2, borderColor: '#a8700f', transform: [{ rotate: '3deg' }] },
  close: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  hud: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  swings: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: '#00000066', borderWidth: 1, borderColor: COLORS.line },
  lvlRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  wallFrame: { padding: 8, borderRadius: 14, backgroundColor: '#05070f', borderWidth: 3, borderColor: '#4a2f17' },
  fill: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute' },
  xpFloat: { position: 'absolute', left: -20, right: -20, top: 0, alignItems: 'center' },
  banner: { position: 'absolute', left: 0, right: 0, top: '38%', alignItems: 'center' },
  bannerText: { fontSize: 44, color: COLORS.teal, textShadowColor: '#000', textShadowRadius: 8, textShadowOffset: { width: 0, height: 3 } },
  note: { fontSize: 11, textAlign: 'center' },
});
