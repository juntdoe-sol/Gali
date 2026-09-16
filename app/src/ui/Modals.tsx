import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { COLORS, gearByKey, RARITY_COLOR } from '../game/constants';
import { play } from '../game/sfx';
import { useGame } from '../game/store';
import { Btn, T } from './kit';

function usePop(trigger: unknown) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.spring(v, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [trigger, v]);
  return v;
}

export function ResultPop() {
  const res = useGame((s) => s.lastResult);
  const at = useGame((s) => s.resultAt);
  const [hidden, setHidden] = useState(0);
  const scale = usePop(at);
  useEffect(() => {
    if (!at) return;
    const id = setTimeout(() => setHidden(at), res?.motherlode ? 6500 : 3600);
    return () => clearTimeout(id);
  }, [at, res]);
  if (!res || hidden === at || !at) return null;
  const row = Math.floor(res.winning / 5) + 1;
  const col = (res.winning % 5) + 1;
  const colors: [string, string] = res.motherlode ? ['#b86bff', COLORS.teal] : res.won ? ['#ffe08a', COLORS.gold2] : [COLORS.card2, COLORS.card];
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Animated.View style={{ transform: [{ scale }, { rotate: scale.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '0deg'] }) }] }}>
        <Pressable onPress={() => setHidden(at)}>
          <LinearGradient colors={colors} style={[styles.result, { borderColor: res.won ? '#fff3c0' : COLORS.line }]}>
            {res.motherlode && res.won ? (
              <>
                <T v="display" style={[styles.rTitle, { color: '#fff' }]}>
                  💎 MOTHERLODE 💎
                </T>
                <T v="display" style={[styles.rBig, { color: '#fff' }]}>
                  +{res.points.toLocaleString()}
                </T>
              </>
            ) : res.won ? (
              <>
                <T v="display" style={[styles.rTitle, { color: '#4a1f00' }]}>
                  STRUCK ORE!
                </T>
                <T v="display" style={[styles.rBig, { color: '#4a1f00' }]}>
                  +{res.points.toLocaleString()} pts
                </T>
                <T v="bold" style={{ color: '#6b3a00' }}>
                  {res.covered === 1 ? 'Single-block snipe!' : `${res.covered} blocks covered`}
                  {res.onChain ? ' · settled on Solana' : ''}
                </T>
              </>
            ) : (
              <>
                <T v="display" style={styles.rTitle}>
                  Dry rock…
                </T>
                <T v="bold" style={{ color: COLORS.muted }}>
                  Ore was at row {row}, col {col}. Dig again!
                </T>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function LevelUp() {
  const lvl = useGame((s) => s.levelUp);
  const clear = useGame((s) => Date.now() - s.resultAt > 2600);
  const dismiss = useGame((s) => s.dismissLevel);
  const show = Boolean(lvl && clear);
  const spin = usePop(show ? lvl : 0);
  useEffect(() => {
    if (!show) return;
    play('levelup');
    const id = setTimeout(dismiss, 2800);
    return () => clearTimeout(id);
  }, [show, dismiss]);
  if (!show) return null;
  return (
    <Pressable style={[styles.center, { backgroundColor: '#3de0c822' }]} onPress={dismiss}>
      <Animated.View style={[styles.ring, { transform: [{ scale: spin }, { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['-180deg', '0deg'] }) }] }]}>
        <T v="black" style={{ color: '#0d3a33', letterSpacing: 3, fontSize: 12 }}>
          LEVEL
        </T>
        <T v="display" style={{ fontSize: 68, color: '#fff', lineHeight: 72 }}>
          {lvl}
        </T>
      </Animated.View>
      <T v="display" style={{ fontSize: 36, marginTop: 10 }}>
        Level up!
      </T>
    </Pressable>
  );
}

export function GearReveal() {
  const key = useGame((s) => s.gearReveal);
  const dismiss = useGame((s) => s.dismissGear);
  const flip = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!key) return;
    flip.setValue(0);
    Animated.timing(flip, { toValue: 1, duration: 900, delay: 500, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
  }, [key, flip]);
  if (!key) return null;
  const g = gearByKey(key);
  const c = RARITY_COLOR[g.rarity];
  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable style={[styles.center, { backgroundColor: '#0d0814dd' }]} onPress={dismiss}>
        <Animated.View
          style={[
            styles.card,
            { borderColor: c, shadowColor: c },
            { transform: [{ perspective: 800 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) }] },
          ]}
        >
          <T v="black" style={{ color: c, letterSpacing: 2 }}>
            {g.rarity.toUpperCase()}
          </T>
          <View style={[styles.orb, { backgroundColor: g.accent, shadowColor: g.accent }]}>
            <T style={{ fontSize: 50 }}>{g.kind === 'pickaxe' ? '⛏' : '⛑'}</T>
          </View>
          <T v="display" style={{ fontSize: 28 }}>
            {g.name}
          </T>
          <T v="muted">Paid with SKR · equipped</T>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export function Busy() {
  const busy = useGame((s) => s.wallet.busy);
  if (!busy) return null;
  return (
    <View style={styles.busy} pointerEvents="none">
      <T v="bold" style={{ color: COLORS.skr }}>
        ◈ {busy}
      </T>
    </View>
  );
}

const STEPS = [
  { t: 'Dig. Strike ore. Climb.', b: 'Every minute a new round opens on a 5x5 mine. Tap blocks, then hit DIG. You get 30 free digs a day.' },
  { t: 'Fewer blocks, bigger strike', b: 'One block strikes ore each round. Cover 1 block and win 1,000 pts. Cover all 25 and win 40. Shake your phone to dig 3 random blocks.' },
  { t: 'Bring your Seeker wallet', b: 'Connect with Mobile Wallet Adapter to dig on Solana. Approve once and a 24h session key makes each dig one tap. Stake SKR for up to 1.5x points.' },
];

export function Onboarding() {
  const onboarded = useGame((s) => s.save.onboarded);
  const loaded = useGame((s) => s.loaded);
  const finish = useGame((s) => s.finishOnboarding);
  const connect = useGame((s) => s.connect);
  const [i, setI] = useState(0);
  if (!loaded || onboarded) return null;
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <Modal transparent visible animationType="fade">
      <View style={[styles.center, { backgroundColor: '#0d0814ee', padding: 20 }]}>
        <View style={styles.intro}>
          <Image source={require('../../assets/brand/wordmark.png')} style={{ width: 220, height: 97, alignSelf: 'center' }} resizeMode="contain" />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginVertical: 10 }}>
            {STEPS.map((_, k) => (
              <View key={k} style={{ width: k === i ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: k === i ? COLORS.gold : COLORS.line }} />
            ))}
          </View>
          <T v="display" style={{ fontSize: 26, textAlign: 'center' }}>
            {s.t}
          </T>
          <T style={{ textAlign: 'center', marginTop: 8, lineHeight: 21, color: COLORS.muted }}>{s.b}</T>
          <View style={{ gap: 8, marginTop: 18 }}>
            {last ? (
              <>
                <Btn
                  kind="skr"
                  label="Connect wallet"
                  onPress={() => {
                    finish();
                    void connect();
                  }}
                />
                <Btn kind="ghost" label="Practice first" onPress={finish} />
              </>
            ) : (
              <Btn kind="gold" label="Next" onPress={() => setI(i + 1)} />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  result: { minWidth: 260, alignItems: 'center', borderRadius: 26, borderWidth: 4, paddingHorizontal: 26, paddingVertical: 16 },
  rTitle: { fontSize: 26 },
  rBig: { fontSize: 44, lineHeight: 50 },
  ring: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#2bb5a2',
    borderWidth: 6,
    borderColor: '#e8fffb',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.teal,
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 12,
  },
  card: {
    width: 250,
    height: 330,
    borderRadius: 24,
    borderWidth: 4,
    backgroundColor: COLORS.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowOpacity: 1,
    shadowRadius: 30,
    elevation: 14,
    backfaceVisibility: 'hidden',
  },
  orb: { width: 110, height: 110, borderRadius: 55, alignItems: 'center', justifyContent: 'center', shadowOpacity: 1, shadowRadius: 24, elevation: 10 },
  busy: { position: 'absolute', alignSelf: 'center', top: '52%', backgroundColor: '#1b1426ee', borderColor: COLORS.skr, borderWidth: 2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  intro: { width: '100%', maxWidth: 420, backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 3, borderRadius: 28, padding: 22 },
});
