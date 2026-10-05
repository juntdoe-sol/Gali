import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { COLORS, gearByKey, RARITY_COLOR } from '../game/constants';
import { fmtSol } from '../game/pot';
import { GEAR_ICON as PIXEL_ICON } from './gearIcons';
import { GEAR_ICON } from './icons';
import { play } from '../game/sfx';
import { chainReady, CLUSTER, LIVE_MAX_ROUND_SOL, oreLive } from '../chain/light';
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
                  +{(res.oreMotherlode ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ORE
                </T>
                {oreLive && !chainReady && res.onChain ? null : (
                  <T v="display" style={{ fontSize: 22, color: '#fff3c0' }}>
                    {res.skr > 0 ? `+${res.skr.toLocaleString(undefined, { maximumFractionDigits: 2 })} SKR` : 'SKR pool was empty'}
                  </T>
                )}
                <SolLine res={res} dark={false} />
              </>
            ) : res.won ? (
              <>
                <T v="display" style={[styles.rTitle, { color: '#4a1f00' }]}>
                  STRUCK GOLD!
                </T>
                <SolLine res={res} dark big />
              </>
            ) : (
              <>
                <T v="display" style={styles.rTitle}>
                  Dry rock…
                </T>
                {res.solIn ? (
                  <T v="display" style={{ fontSize: 22, color: COLORS.red }}>
                    −{fmtSol(Math.max(0, res.solIn - res.solOut))} SOL
                  </T>
                ) : null}
                {res.solOut > 0 ? (
                  <T v="bold" style={{ fontSize: 14, color: COLORS.muted }}>
                    {fmtSol(res.solOut)} SOL back to claim
                  </T>
                ) : null}
              </>
            )}
          </LinearGradient>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** The win, kept to two lines: SOL back and ORE mined. Points show in the HUD and the Rounds tab. */
function SolLine({ res, dark, big }: { res: RoundResult; dark: boolean; big?: boolean }) {
  if (!res.solIn) return null;
  return (
    <View style={{ alignItems: 'center' }}>
      <T v="display" style={{ fontSize: big ? 40 : 26, lineHeight: big ? 46 : 30, color: dark ? '#0b5a3a' : '#c8ffe6' }}>
        +{fmtSol(res.solOut)} SOL back
      </T>
      {res.oreMined ? (
        <T v="display" style={{ fontSize: big ? 24 : 18, color: dark ? '#3d5a00' : '#eaffc4' }}>
          {res.lucky ? '★ ' : ''}+{res.oreMined.toLocaleString(undefined, { maximumFractionDigits: 2 })} ORE {res.lucky ? 'solo winner!' : 'mined'}
        </T>
      ) : res.won && res.split === false ? (
        <T v="bold" style={{ fontSize: 12, color: dark ? '#3d5a00' : '#eaffc4' }}>
          ★ Solo spot: another miner took the ORE
        </T>
      ) : null}
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
            {PIXEL_ICON[g.key] ? (
              <Image source={PIXEL_ICON[g.key]} style={{ width: 80, height: 80 }} {...({ dataSet: { pixelart: '1' } } as object)} />
            ) : (
              <T style={{ fontSize: 50 }}>{GEAR_ICON[g.kind]}</T>
            )}
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
            {CLUSTER === 'devnet' ? 'Switch the wallet to Solana devnet to see your test balances.' : 'Gali plays on Solana mainnet with real SOL.'}
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

/** Shown once, before the first wallet connect in a mainnet build: this is real money. */
export function LiveNotice() {
  const open = useGame((s) => Boolean(s.liveNotice));
  const accept = useGame((s) => s.acceptLive);
  const decline = useGame((s) => s.declineLive);
  if (!open) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={decline}>
      <View style={[styles.center, { backgroundColor: '#040817dd', padding: 16 }]}>
        <View style={styles.intro}>
          <T v="display" style={{ fontSize: 24, marginBottom: 6 }}>
            Real SOL, real rounds
          </T>
          <T style={{ marginBottom: 8 }}>
            With a wallet connected, you play live rounds on ORE&apos;s board on Solana mainnet with real SOL. ORE keeps 1% of every spot, plus 10% more of spots that miss. Only the gold spot mines ORE.
          </T>
          <T style={{ marginBottom: 8 }}>
            Your wallet signs every deploy and every claim. Gali takes no cut and never holds your SOL. A round is capped at {LIVE_MAX_ROUND_SOL} SOL.
          </T>
          <T v="muted" style={{ marginBottom: 14 }}>
            This is a game of chance. You must be 18 or older, and it must be legal where you live. Only play with SOL you can afford to lose.
          </T>
          <Btn kind="skr" label="I'm 18+ · connect wallet" onPress={accept} />
        </View>
      </View>
    </Modal>
  );
}

/** Live build: nothing runs without a wallet, so the gate stays up until one connects. */
export function WalletGate() {
  const show = useGame((s) => oreLive && s.loaded && s.save.onboarded && !s.wallet.owner && !s.liveNotice && !s.walletPicker);
  const connect = useGame((s) => s.connect);
  if (!show) return null;
  return (
    <Modal transparent visible animationType="fade">
      <View style={[styles.center, { backgroundColor: '#040817ee', padding: 20 }]}>
        <View style={styles.intro}>
          <Image source={require('../../assets/brand/wordmark.png')} style={{ width: 220, height: 97, alignSelf: 'center' }} resizeMode="contain" />
          <T v="display" style={{ fontSize: 24, textAlign: 'center', marginTop: 6 }}>
            Live on ORE&apos;s board
          </T>
          <T style={{ textAlign: 'center', marginTop: 8, lineHeight: 21, color: COLORS.muted }}>
            Connect your wallet to mine. Every deploy and claim is signed by you on Solana mainnet.
          </T>
          <View style={{ marginTop: 18 }}>
            <Btn kind="skr" label="Connect wallet" onPress={() => void connect()} />
          </View>
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
  { t: 'Deploy SOL. Strike gold.', b: 'Every minute a new round opens on an island with 25 mining spots. Put SOL on the spots you pick. One spot strikes gold and mines the round\u2019s ORE. Most of your SOL comes back each round: ORE keeps 1%, plus 10% on spots that miss. Tap MINE to play.' },
  { t: 'Mine ORE, chase two jackpots', b: 'Every round mines 1 ORE for the miners on the gold spot, split by their SOL there. On one of the round\u2019s 10 solo spots (\u2605), one miner takes it all, with odds equal to their share. 1 round in 500, ORE\u2019s motherlode hits and Gali\u2019s SKR pool pays the same winners. Shake your phone to Smart-pick.' },
  { t: 'Bring your Seeker wallet', b: oreLive ? 'Connect with Mobile Wallet Adapter to play ORE\u2019s live board on mainnet. Your wallet signs every deploy and claim. It is a game of chance: only use SOL you can afford to lose.' : 'Practice first with 2 play SOL, or connect with Mobile Wallet Adapter. Fund a 24h session once and PRO autopilot deploys every round for you. It is a game of chance: only use SOL you can afford to lose.' },
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
                {oreLive ? null : <Btn kind="ghost" label="Practice first" onPress={finish} />}
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
