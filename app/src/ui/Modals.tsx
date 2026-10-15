import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { COLORS, gearByKey, RARITY_COLOR } from '../game/constants';
import { fmtSol } from '../game/pot';
import { GEAR_ICON as PIXEL_ICON } from './gearIcons';
import { GEAR_ICON } from './icons';
import { play } from '../game/sfx';
import { chainReady, CLUSTER, LIVE_MAX_ROUND_SOL, oreLive } from '../chain/light';
import { useGame, type RoundResult } from '../game/store';
import { Btn, FocusRing, Frame, Kbd, ModalCenter, PixelBox, Scrim, T, TONE, U, Window } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { LANDSCAPE_APP, useLayout } from './layout';

const isWeb = Platform.OS === 'web';

function usePop(trigger: unknown) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.spring(v, { toValue: 1, friction: 5, tension: 120, useNativeDriver: !isWeb }).start();
  }, [trigger, v]);
  return v;
}

/** A blink in steps, like a cursor: on, off, on. */
function useBlink(ms = 560) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((v) => !v), ms);
    return () => clearInterval(id);
  }, [ms]);
  return on;
}

/** Enter starts the main action of a full-screen dialog on a keyboard. */
function useEnter(fn: () => void, on: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!on || !isWeb || typeof window === 'undefined') return;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat) ref.current();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [on]);
}

/** Pixel rays behind a win: eight blocks that turn slowly. */
function Rays({ color }: { color: string }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: !isWeb }));
    loop.start();
    return () => loop.stop();
  }, [spin]);
  return (
    <Animated.View pointerEvents="none" style={[styles.rays, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={[styles.ray, { backgroundColor: color, transform: [{ rotate: `${i * 45}deg` }] }]} />
      ))}
    </Animated.View>
  );
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
  const mother = Boolean(res.motherlode && res.won);
  const t = mother ? { fill: '#7a3fc4', hi: '#d9b0ff', lo: '#3a1a6a', edge: '#12052a' } : res.won ? TONE.gold : { fill: 'rgba(15,23,52,0.97)', hi: '#33498c', lo: '#0c1430', edge: '#04060f' };
  return (
    <View style={styles.center} pointerEvents="box-none">
      <Animated.View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
        {res.won ? <Rays color={mother ? 'rgba(61,224,200,0.35)' : 'rgba(255,224,138,0.35)'} /> : null}
        <Pressable onPress={() => setHidden(at)} accessibilityRole="button" accessibilityLabel="Dismiss result">
          <PixelBox fill={t.fill} hi={t.hi} lo={t.lo} edge={t.edge} shadow={3} rivets={res.won ? t.hi : undefined} style={styles.result}>
            {mother ? (
              <>
                <View style={styles.rRow}>
                  <PixIcon name="ore" size={32} />
                  <T v="display" style={[styles.rTitle, { color: '#fff' }]}>
                    MOTHERLODE
                  </T>
                  <PixIcon name="ore" size={32} />
                </View>
                <T v="display" style={{ fontSize: 34, color: '#eaffc4' }}>
                  +{(res.oreMotherlode ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ORE
                </T>
                {oreLive && !chainReady && res.onChain ? null : (
                  <T v="display" style={{ fontSize: 24, color: '#fff3c0' }}>
                    {res.skr > 0 ? `+${res.skr.toLocaleString(undefined, { maximumFractionDigits: 2 })} SKR` : 'SKR pool was empty'}
                  </T>
                )}
                <SolLine res={res} dark={false} />
                {res.points > 0 ? (
                  <T v="display" style={{ fontSize: 20, color: '#fff3c0' }}>
                    +{res.points.toLocaleString()} PTS
                  </T>
                ) : null}
              </>
            ) : res.won ? (
              <>
                <View style={styles.rRow}>
                  <PixIcon name="star" size={28} />
                  <T v="display" style={[styles.rTitle, { color: '#4a1f00' }]}>
                    STRUCK GOLD!
                  </T>
                  <PixIcon name="star" size={28} />
                </View>
                <SolLine res={res} dark big />
                {res.points > 0 ? (
                  <T v="display" style={{ fontSize: 20, color: '#4a1f00' }}>
                    +{res.points.toLocaleString()} PTS
                  </T>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.rRow}>
                  <PixIcon name="pick" size={28} />
                  <T v="display" style={styles.rTitle}>
                    DRY ROCK
                  </T>
                </View>
                {res.solIn ? (
                  <T v="display" style={{ fontSize: 24, color: COLORS.red }}>
                    -{fmtSol(Math.max(0, res.solIn - res.solOut))} SOL
                  </T>
                ) : null}
                {res.solOut > 0 ? (
                  <T v="bold" style={{ fontSize: 14, color: COLORS.muted }}>
                    {fmtSol(res.solOut)} SOL back to claim
                  </T>
                ) : null}
              </>
            )}
          </PixelBox>
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
      <T v="display" style={{ fontSize: big ? 42 : 28, lineHeight: big ? 46 : 30, color: dark ? '#0b5a3a' : '#c8ffe6' }}>
        +{fmtSol(res.solOut)} SOL BACK
      </T>
      {res.oreMined ? (
        <T v="display" style={{ fontSize: big ? 26 : 20, color: dark ? '#3d5a00' : '#eaffc4' }}>
          +{res.oreMined.toLocaleString(undefined, { maximumFractionDigits: 2 })} ORE {res.lucky ? 'SOLO WINNER!' : 'MINED'}
        </T>
      ) : res.won && res.split === false ? (
        <T v="bold" style={{ fontSize: 13, color: dark ? '#3d5a00' : '#eaffc4' }}>
          Solo spot: another miner took the ORE
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
  const pop = usePop(show ? lvl : 0);
  useEffect(() => {
    if (!show) return;
    play('levelup');
    const id = setTimeout(dismiss, 2800);
    return () => clearTimeout(id);
  }, [show, dismiss]);
  if (!show) return null;
  return (
    <Pressable style={[styles.center, { backgroundColor: 'rgba(61,224,200,0.12)' }]} onPress={dismiss} accessibilityLabel={`Level ${lvl}. Dismiss`}>
      <Animated.View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ scale: pop }] }}>
        <Rays color="rgba(61,224,200,0.3)" />
        <PixelBox fill={TONE.teal.fill} hi={TONE.teal.hi} lo={TONE.teal.lo} edge={TONE.teal.edge} u={U * 2} shadow={2} style={styles.lvlBox}>
          <T v="display" style={{ color: '#032026', letterSpacing: 3, fontSize: 18 }}>
            LEVEL
          </T>
          <T v="display" style={{ fontSize: 80, color: '#fff', lineHeight: 80 }}>
            {lvl}
          </T>
        </PixelBox>
      </Animated.View>
      <T v="display" style={{ fontSize: 40, marginTop: 18, letterSpacing: 2 }}>
        LEVEL UP!
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
    Animated.timing(flip, { toValue: 1, duration: 900, delay: 500, easing: Easing.out(Easing.back(1.4)), useNativeDriver: !isWeb }).start();
  }, [key, flip]);
  if (!key) return null;
  const g = gearByKey(key);
  if (!g) return null;
  const c = RARITY_COLOR[g.rarity];
  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismiss}>
      <Pressable style={[styles.center, { backgroundColor: 'rgba(4,6,15,0.86)' }]} onPress={dismiss}>
        <Animated.View style={{ alignItems: 'center', justifyContent: 'center', transform: [{ perspective: 800 }, { rotateY: flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] }) }] }}>
          <Rays color={c + '44'} />
          <PixelBox fill="rgba(15,23,52,0.98)" hi={c} lo="#04060f" u={U * 2} shadow={2} rivets={c} style={styles.card}>
            <T v="display" style={{ color: c, letterSpacing: 3, fontSize: 20 }}>
              {g.rarity.toUpperCase()}
            </T>
            <PixelBox fill={g.accent + '33'} hi={g.accent} lo="#04060f" style={styles.orb}>
              {PIXEL_ICON[g.key] ? <Image source={PIXEL_ICON[g.key]} style={{ width: 96, height: 96 }} {...({ dataSet: { pixelart: '1' } } as object)} /> : <PixIcon name={GEAR_ICON[g.kind]} size={64} />}
            </PixelBox>
            <T v="display" style={{ fontSize: 30, textAlign: 'center' }}>
              {g.name}
            </T>
            <T v="muted">Paid with SKR · equipped</T>
          </PixelBox>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export function WalletPicker() {
  const wallets = useGame((s) => s.walletPicker);
  const close = useGame((s) => s.closeWalletPicker);
  const busy = useGame((s) => s.wallet.busy);
  const connect = useGame((s) => s.connect);
  // number keys pick a wallet from the list
  useEffect(() => {
    if (!wallets || !isWeb || typeof window === 'undefined') return;
    const k = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= wallets.length && !useGame.getState().wallet.busy) void connect(wallets[n - 1].name);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [wallets, connect]);
  if (!wallets) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Scrim onPress={close}>
        <Window title={wallets.length ? 'PICK A WALLET' : 'NO WALLET HERE'} sub={wallets.length === 0 ? undefined : CLUSTER === 'devnet' ? 'Switch the wallet to Solana devnet to see your test balances.' : 'Gali plays on Solana mainnet with real SOL.'} onClose={close} width={420}>
          {wallets.length === 0 ? <NoWallet /> : null}
          {wallets.map((w, i) => (
            <Pressable key={w.name} disabled={Boolean(busy)} accessibilityState={{ disabled: Boolean(busy) }} onPress={() => void connect(w.name)} accessibilityRole="button" accessibilityLabel={`Connect ${w.name}`}>
              {(st) => {
                const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
                return (
                  <PixelBox fill={hovered ? '#1d2d5e' : '#0b1430'} hi={hovered ? COLORS.gold : '#2d4282'} lo="#04060f" shadow={pressed ? 0 : 1} style={[styles.walletRow, { transform: [{ translateY: pressed ? U : 0 }] }]}>
                    {w.icon ? <Image source={{ uri: w.icon }} style={styles.walletIcon} /> : <PixIcon name="wallet" size={32} />}
                    <T v="display" style={{ fontSize: 22, flex: 1 }}>
                      {w.name}
                    </T>
                    {i < 9 ? <Kbd k={String(i + 1)} /> : null}
                    <T v="display" style={{ fontSize: 20, color: hovered ? COLORS.gold : COLORS.muted }}>
                      {'>'}
                    </T>
                    {focused ? <FocusRing /> : null}
                  </PixelBox>
                );
              }}
            </Pressable>
          ))}
          <WalletFeedback />
        </Window>
      </Scrim>
    </Modal>
  );
}

/**
 * No Solana wallet in this browser. Phones have no wallet extensions, so the way in is a wallet app's own
 * browser (Phantom and Solflare open any page there); computers can add an extension and try again.
 */
function NoWallet() {
  const { mouse } = useLayout();
  const connect = useGame((s) => s.connect);
  const here = typeof window !== 'undefined' && window.location ? window.location.href : 'https://galiisland.bounded.page';
  const ref = typeof window !== 'undefined' && window.location ? window.location.origin : 'https://galiisland.bounded.page';
  const open = (u: string) => {
    if (typeof window !== 'undefined') window.location.href = u;
  };
  const enc = encodeURIComponent;
  return (
    <View style={{ gap: 10 }}>
      <T style={{ fontSize: 14, lineHeight: 20 }}>
        {mouse
          ? 'This browser has no Solana wallet. Add the Phantom, Solflare or Jupiter extension, then try again.'
          : 'Phone browsers have no Solana wallet. Open Gali inside your wallet app instead: it has its own browser.'}
      </T>
      {mouse ? null : (
        <>
          <Btn kind="plain" label="Open in Phantom" icon={<PixIcon name="wallet" size={20} />} onPress={() => open(`https://phantom.com/ul/browse/${enc(here)}?ref=${enc(ref)}`)} />
          <Btn kind="plain" label="Open in Solflare" icon={<PixIcon name="wallet" size={20} />} onPress={() => open(`https://solflare.com/ul/v1/browse/${enc(here)}?ref=${enc(ref)}`)} />
          <T v="muted" style={{ fontSize: 12 }}>On a Seeker, the Gali app connects to your Seed Vault directly.</T>
        </>
      )}
      <Btn kind="skr" label="Try again" onPress={() => void connect()} />
    </View>
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
      <Scrim>
        <Window title="REAL SOL, REAL ROUNDS" onClose={decline} width={460} accent={COLORS.gold}>
          <Bullet icon="ore" text="With a wallet connected you play live rounds on ORE's board on Solana mainnet with real SOL. ORE keeps 1% of every spot, plus 10% more of spots that miss. Only the gold spot mines ORE." />
          <Bullet icon="wallet" text={`Your wallet signs every deploy and every claim. Gali takes no cut and never holds your SOL. A round is capped at ${LIVE_MAX_ROUND_SOL} SOL.`} />
          <Bullet icon="warn" text="This is a game of chance with real SOL. Only play with SOL you can afford to lose." muted />
          <Btn kind="skr" label="Got it · connect wallet" onPress={accept} kbd="ENTER" />
          <EnterKey fn={accept} />
        </Window>
      </Scrim>
    </Modal>
  );
}

function EnterKey({ fn }: { fn: () => void }) {
  useEnter(fn, true);
  return null;
}

function Bullet({ icon, text, muted }: { icon: PixName; text: string; muted?: boolean }) {
  return (
    <View style={styles.bullet}>
      <PixIcon name={icon} size={24} />
      <T v={muted ? 'muted' : 'body'} style={{ flex: 1, fontSize: 14, lineHeight: 20 }}>
        {text}
      </T>
    </View>
  );
}

const PILLARS: { icon: PixName; t: string; b: string }[] = [
  { icon: 'ore', t: 'MINE ORE', b: 'Pick spots on a live island and strike gold on ORE’s board.' },
  { icon: 'cart', t: 'PLAY TO EARN', b: 'Mini games with ORE and SKR tables, a new round every 40 seconds.' },
  { icon: 'bag', t: 'TRADE GEAR', b: 'Pickaxes, helmets and pets for your miner.' },
];

/** The title screen: the live game is wallet-gated, nothing plays until a wallet is connected. */
export function WalletGate() {
  const busy = useGame((s) => s.wallet.busy);
  const show = useGame((s) => oreLive && s.loaded && s.save.onboarded && !s.wallet.owner && !s.liveNotice && !s.walletPicker);
  const connect = useGame((s) => s.connect);
  const { desktop, mouse } = useLayout();
  const blink = useBlink();
  useEnter(() => {
    if (!busy) void connect();
  }, show);
  if (!show) return null;
  return (
    <Modal transparent visible animationType="fade">
      <ModalCenter>
        <Frame style={[styles.gate, desktop && { maxWidth: 760, paddingHorizontal: 40 }]}>
          <Image source={require('../../assets/brand/wordmark.png')} style={{ width: LANDSCAPE_APP ? 180 : desktop ? 300 : 220, height: LANDSCAPE_APP ? 79 : desktop ? 132 : 97, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Gali" />
          <T v="display" style={{ fontSize: desktop ? 22 : 18, textAlign: 'center', color: COLORS.gold, letterSpacing: 2 }}>
            THE ORE MINING GAME
          </T>
          <T style={{ textAlign: 'center', marginTop: 6, fontSize: 15, lineHeight: 21, color: COLORS.muted }}>
            Mine ORE in a mini open-world pixel game on Solana.
          </T>
          <View style={[styles.pillars, !desktop && { flexDirection: 'column' }]}>
            {PILLARS.map((p) => (
              <PixelBox key={p.t} fill="rgba(6,10,28,0.8)" hi="#22356f" lo="#04060f" style={[styles.pillar, !desktop && styles.pillarRow]}>
                <PixIcon name={p.icon} size={desktop ? 40 : 32} />
                <View style={{ flex: desktop ? undefined : 1, alignItems: desktop ? 'center' : 'flex-start' }}>
                  <T v="display" style={{ fontSize: 19, color: COLORS.gold, letterSpacing: 1 }}>
                    {p.t}
                  </T>
                  <T v="muted" style={{ fontSize: 13, textAlign: desktop ? 'center' : 'left' }}>
                    {p.b}
                  </T>
                </View>
              </PixelBox>
            ))}
          </View>
          <WalletFeedback />
          <Btn kind="skr" label={busy ? busy : 'CONNECT WALLET'} disabled={Boolean(busy)} onPress={() => void connect()} icon={<PixIcon name="wallet" size={22} />} />
          <T v="display" style={{ textAlign: 'center', marginTop: 10, fontSize: 16, letterSpacing: 2, color: COLORS.muted, opacity: blink ? 1 : 0.15 }}>
            {mouse && desktop ? 'PRESS ENTER TO START' : 'TAP CONNECT TO START'}
          </T>
          <T v="muted" style={{ textAlign: 'center', marginTop: 8, fontSize: 12 }}>
            Every deploy and claim is signed by your wallet on Solana mainnet. 18+.
          </T>
        </Frame>
      </ModalCenter>
    </Modal>
  );
}

// Native Modals sit above ordinary app overlays; feedback must live in their tree.
function WalletFeedback() {
  const busy = useGame((s) => s.wallet.busy);
  const error = useGame((s) => { const bad = s.toasts.filter((t) => t.tone === 'bad'); return bad[bad.length - 1]?.text; });
  if (!busy && !error) return null;
  return (
    <View accessibilityRole={busy ? 'text' : 'alert'} accessibilityLiveRegion="polite">
      <PixelBox fill={busy ? 'rgba(168,224,90,0.12)' : 'rgba(226,73,59,0.14)'} hi={busy ? COLORS.skr : COLORS.red} lo="#04060f" style={styles.feedback}>
        <PixIcon name={busy ? 'clock' : 'warn'} size={18} />
        <T v="bold" style={{ color: busy ? COLORS.skr : '#ffb3ab', flexShrink: 1 }}>
          {busy || error}
        </T>
      </PixelBox>
    </View>
  );
}

/** Three pixel blocks that light in turn while the wallet or the chain is busy. */
function Loader() {
  const [k, setK] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setK((v) => (v + 1) % 3), 180);
    return () => clearInterval(id);
  }, []);
  return (
    <View style={{ flexDirection: 'row', gap: U }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: U * 3, height: U * 3, backgroundColor: i === k ? COLORS.skr : '#2d4a20' }} />
      ))}
    </View>
  );
}

export function Busy() {
  const busy = useGame((s) => s.wallet.busy);
  if (!busy) return null;
  return (
    <View style={styles.busyWrap} pointerEvents="none">
      <PixelBox fill="rgba(8,13,32,0.95)" hi={COLORS.skr} lo="#04060f" shadow={2} style={styles.busy}>
        <Loader />
        <T v="display" style={{ color: COLORS.skr, fontSize: 18 }}>
          {busy}
        </T>
      </PixelBox>
    </View>
  );
}

function useSteps() {
  const { mouse } = useLayout();
  return [
    { icon: 'ore' as PixName, t: 'DEPLOY SOL. STRIKE GOLD.', b: `A new round opens on an island with 25 mining spots. Put SOL on the spots you pick. One spot strikes gold and mines the round’s ORE. Most of your SOL comes back each round: ORE keeps 1%, plus 10% on spots that miss. ${mouse ? 'Click' : 'Tap'} spots on the map, then MINE.` },
    { icon: 'star' as PixName, t: 'MINE ORE, CHASE TWO JACKPOTS', b: `Every round mines 1 ORE for the miners on the gold spot, split by their SOL there. On one of the round’s 10 solo spots, one miner takes it all, with odds equal to their share. 1 round in 500, ORE’s motherlode hits and Gali’s SKR pool pays the same winners.${mouse ? '' : ' Shake your phone to Smart-pick.'}` },
    { icon: 'wallet' as PixName, t: 'BRING YOUR WALLET', b: oreLive ? `Connect ${mouse ? 'a browser wallet' : 'with Mobile Wallet Adapter'} to play ORE’s live board on mainnet. Your wallet signs every deploy and claim. It is a game of chance: only use SOL you can afford to lose.` : 'Practice first with 2 play SOL, or connect with Mobile Wallet Adapter. Fund a 24h session once and PRO autopilot deploys every round for you. It is a game of chance: only use SOL you can afford to lose.' },
  ];
}

export function Onboarding() {
  const onboarded = useGame((s) => s.save.onboarded);
  const loaded = useGame((s) => s.loaded);
  const finish = useGame((s) => s.finishOnboarding);
  const connect = useGame((s) => s.connect);
  const steps = useSteps();
  const [i, setI] = useState(0);
  const show = loaded && !onboarded;
  const last = i === steps.length - 1;
  const next = () => {
    if (!last) setI(i + 1);
    else {
      finish();
      void connect();
    }
  };
  useEnter(next, show);
  if (!show) return null;
  const s = steps[i];
  return (
    <Modal transparent visible animationType="fade">
      <ModalCenter>
        <Frame style={[styles.gate, LANDSCAPE_APP && { maxWidth: 620 }]}>
          {LANDSCAPE_APP ? null : <Image source={require('../../assets/brand/wordmark.png')} style={{ width: 200, height: 88, alignSelf: 'center' }} resizeMode="contain" />}
          <View style={styles.dots} accessibilityLabel={`Step ${i + 1} of ${steps.length}`}>
            {steps.map((_, k) => (
              <Pressable key={k} onPress={() => setI(k)} accessibilityRole="button" accessibilityLabel={`Step ${k + 1}`}>
                <View style={{ width: k === i ? 24 : 8, height: 8, backgroundColor: k === i ? COLORS.gold : k < i ? '#8a6a20' : '#22356f' }} />
              </Pressable>
            ))}
          </View>
          <PixelBox fill="rgba(6,10,28,0.8)" hi="#22356f" lo="#04060f" style={styles.stepIcon}>
            <PixIcon name={s.icon} size={48} />
          </PixelBox>
          <T v="display" style={{ fontSize: 28, lineHeight: 30, textAlign: 'center', letterSpacing: 1 }}>
            {s.t}
          </T>
          <T style={{ textAlign: 'center', marginTop: 6, fontSize: 15, lineHeight: 21, color: COLORS.muted }}>{s.b}</T>
          <View style={{ gap: 8, marginTop: 16 }}>
            {last ? (
              <>
                <Btn kind="skr" label="Connect wallet" kbd="ENTER" icon={<PixIcon name="wallet" size={22} />} onPress={next} />
                {oreLive ? null : <Btn kind="ghost" label="Practice first" onPress={finish} />}
              </>
            ) : (
              <Btn kind="gold" label="Next" kbd="ENTER" onPress={next} />
            )}
          </View>
        </Frame>
      </ModalCenter>
    </Modal>
  );
}

const styles = StyleSheet.create({
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 58 },
  walletIcon: { width: 32, height: 32 },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  result: { minWidth: 280, alignItems: 'center', paddingHorizontal: 28, paddingVertical: 18, gap: 2 },
  rRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rTitle: { fontSize: 34, lineHeight: 36, letterSpacing: 2 },
  rays: { position: 'absolute', width: 420, height: 420, alignItems: 'center', justifyContent: 'center' },
  ray: { position: 'absolute', width: 28, height: 420 },
  lvlBox: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  card: { width: 270, height: 350, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 16 },
  orb: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  busyWrap: { position: 'absolute', left: 0, right: 0, top: '52%', alignItems: 'center', zIndex: 80 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  gate: { width: '100%', maxWidth: 460, padding: 22, gap: 4 },
  pillars: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 16 },
  pillar: { flex: 1, alignItems: 'center', gap: 6, padding: 14 },
  pillarRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginBottom: 10 },
  bullet: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginVertical: 10 },
  stepIcon: { alignSelf: 'center', width: 76, height: 76, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
});
