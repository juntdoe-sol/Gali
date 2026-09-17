import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { COLORS, gearByKey, RARITY_COLOR } from '../game/constants';
import { fmtSol } from '../game/pot';
import { GEAR_ICON } from './icons';
import { play } from '../game/sfx';
import { useGame, type RoundResult } from '../game/store';
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
                <T v="display" style={{ fontSize: 30, color: '#eaffc4' }}>
                  {res.skr > 0 ? `+${res.skr.toLocaleString(undefined, { maximumFractionDigits: 2 })} SKR` : 'Motherlode Pool was empty'}
                </T>
                <SolLine res={res} dark={false} />
                <T v="bold" style={{ color: '#fff' }}>
                  +{res.points.toLocaleString()} pts
                </T>
              </>
            ) : res.won ? (
              <>
                <T v="display" style={[styles.rTitle, { color: '#4a1f00' }]}>
                  STRUCK GOLD!
                </T>
                <SolLine res={res} dark big />
                <T v="bold" style={{ color: '#6b3a00' }}>
                  +{res.points.toLocaleString()} pts · {res.covered === 1 ? 'single-spot snipe!' : `${res.covered} spots covered`}
                  {res.onChain ? ' · settled on Solana' : ''}
                </T>
              </>
            ) : (
              <>
                <T v="display" style={styles.rTitle}>
                  Dry rock…
                </T>
                {res.solIn ? (
                  <T v="display" style={{ fontSize: 22, color: COLORS.red }}>
                    −{fmtSol(res.solIn)} SOL
                  </T>
                ) : null}
                <T v="bold" style={{ color: COLORS.muted }}>
                  Gold was at row {row}, col {col}. Next round!
                </T>
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function SolLine({ res, dark, big }: { res: RoundResult; dark: boolean; big?: boolean }) {
  if (!res.solIn) return null;
  const net = res.solOut - res.solIn;
  return (
    <View style={{ alignItems: 'center' }}>
      <T v="display" style={{ fontSize: big ? 40 : 26, lineHeight: big ? 46 : 30, color: dark ? '#0b5a3a' : '#c8ffe6' }}>
        +{fmtSol(res.solOut)} SOL
      </T>
      {res.skrMined ? (
        <T v="display" style={{ fontSize: big ? 24 : 18, color: dark ? '#3d5a00' : '#eaffc4' }}>
          {res.lucky ? '🍀 ' : ''}+{res.skrMined.toLocaleString(undefined, { maximumFractionDigits: 2 })} SKR {res.lucky ? 'lucky winner!' : 'mined'}
        </T>
      ) : res.won && res.split === false ? (
        <T v="bold" style={{ fontSize: 12, color: dark ? '#3d5a00' : '#eaffc4' }}>
          Lucky draw round: another miner took the SKR
        </T>
      ) : null}
      <T v="bold" style={{ fontSize: 12, color: dark ? '#6b3a00' : '#fff' }}>
        in {fmtSol(res.solIn)} · net {net >= 0 ? '+' : '−'}
        {fmtSol(Math.abs(net))} SOL
      </T>
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
  if (!g) return null;
  const c = RARITY_COLOR[g.rarity];
  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable style={[styles.center, { backgroundColor: '#040817dd' }]} onPress={dismiss}>
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
            <T style={{ fontSize: 50 }}>{GEAR_ICON[g.kind]}</T>
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

export function WalletPicker() {
  const wallets = useGame((s) => s.walletPicker);
  const close = useGame((s) => s.closeWalletPicker);
  const connect = useGame((s) => s.connect);
  if (!wallets) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <View style={[styles.center, { backgroundColor: '#040817dd', padding: 16 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close wallet list" />
        <View style={styles.intro}>
          <T v="display" style={{ fontSize: 24, marginBottom: 4 }}>
            Connect a wallet
          </T>
          <T v="muted" style={{ marginBottom: 14 }}>
            Switch the wallet to Solana devnet to see your test balances.
          </T>
          {wallets.map((w) => (
            <Pressable
              key={w.name}
              onPress={() => void connect(w.name)}
              style={({ pressed }) => [styles.walletRow, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
              accessibilityLabel={`Connect ${w.name}`}
            >
              {w.icon ? <Image source={{ uri: w.icon }} style={styles.walletIcon} /> : <View style={[styles.walletIcon, { backgroundColor: COLORS.line }]} />}
              <T v="bold" style={{ fontSize: 17 }}>
                {w.name}
              </T>
            </Pressable>
          ))}
          <Btn kind="ghost" label="Cancel" onPress={close} />
        </View>
      </View>
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
  { t: 'Deploy SOL. Strike gold.', b: 'Every minute a new round opens on a quarry with 25 mining spots. Put SOL on the spots you pick. One spot strikes gold, and its miners split 90% of the pot.' },
  { t: 'Mine SKR as you go', b: 'Every round mines 200 SKR. Half the time the winners split it; the other half one lucky winner takes it all (more SOL on the spot, better odds). A 1-in-625 motherlode adds 5,000 SKR. Shake your phone to Smart-pick.' },
  { t: 'Bring your Seeker wallet', b: 'Practice first with 2 play SOL, or connect with Mobile Wallet Adapter. Fund a 24h session once and LITE or PRO autopilot deploys every round for you. It is a game of chance: only use SOL you can afford to lose.' },
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
      <View style={[styles.center, { backgroundColor: '#040817ee', padding: 20 }]}>
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
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 2, borderColor: COLORS.line, borderRadius: 16, padding: 12, marginBottom: 10 },
  walletIcon: { width: 32, height: 32, borderRadius: 8 },
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
  busy: { position: 'absolute', alignSelf: 'center', top: '52%', backgroundColor: '#070d20ee', borderColor: COLORS.skr, borderWidth: 2, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  intro: { width: '100%', maxWidth: 420, backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 3, borderRadius: 28, padding: 22 },
});
