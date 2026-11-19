/**
 * Mining Cards in the Market: the eight cards ($10 to $1000) in a grid, each a 2 second loop, and a detail panel with
 * what the card gives. Buying (SKR or ORE) opens with the Market; until then Buy says so. See game/miningCards.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { create } from 'zustand';
import { beginCardRun, CARD_ROUND_SECS, claimCard, useCardRun } from '../game/cardRun';
import { COLORS } from '../game/constants';
import { useMarket } from '../game/market';
import { CARD_RATIO, CARD_TIERS, CARDS_FOR_SALE, cardArt, cleanCode, maskCode, perkLines, tierOf, type CardTier, type CardValue } from '../game/miningCards';
import { playCards, playRedeem, playWallet, type OwnedCard } from '../game/play';
import { play } from '../game/sfx';
import { useGame } from '../game/store';
import { Btn, INPUT, PixelBox, Scrim, T, U, Window } from './kit';
import { PixIcon } from './PixIcon';
import { alpha, Corners, TECH, TechBtn, TechPanel, TechTab } from './tech';
import { useSkills } from '../game/skills';

export function MiningCards({ wide, bottomPad }: { wide: boolean; bottomPad: number }) {
  const [pick, setPick] = useState<CardTier>(CARD_TIERS[0]);
  const [pay, setPay] = useState<'SKR' | 'ORE'>('SKR');
  const cols = wide ? 4 : 2;
  const grid = (width: number) => {
    const gap = 10;
    const cw = Math.floor((width - gap * (cols - 1)) / cols);
    return (
      <View style={[styles.grid, { gap }]}>
        {CARD_TIERS.map((t) => (
          <CardTile key={t.value} t={t} w={cw} on={t.value === pick.value} onPress={() => setPick(t)} />
        ))}
      </View>
    );
  };
  const detail = <CardDetail t={pick} pay={pay} setPay={setPay} />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: wide ? 16 : 12, paddingTop: 6, paddingBottom: bottomPad, gap: 12 }}>
      <View style={styles.intro}>
        <PixIcon name="pick" size={22} />
        <T style={{ flex: 1, fontSize: 13, lineHeight: 18, color: TECH.dim }}>
          A Mining Card funds an autopilot run with SOL, plus a free pack. Pay with SKR or ORE, then enter the card's code in the mining panel and it starts mining.
        </T>
      </View>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <Measure style={{ flex: 1 }}>{(w) => grid(w)}</Measure>
          <View style={{ width: 300 }}>{detail}</View>
        </View>
      ) : (
        <>
          {detail}
          <Measure>{(w) => grid(w)}</Measure>
        </>
      )}
    </ScrollView>
  );
}

function CardTile({ t, w, on, onPress }: { t: CardTier; w: number; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        play('select');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${t.name} mining card, $${t.value}`}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.tile,
        { width: w, borderColor: on ? t.hue : hovered ? alpha(t.hue, 0.6) : TECH.rule, backgroundColor: on ? alpha(t.hue, 0.12) : TECH.panel, transform: [{ translateY: pressed ? U : hovered ? -U : 0 }] },
      ]}
    >
      <Image source={cardArt(t.value)} style={{ width: w - 12, height: Math.round((w - 12) * CARD_RATIO) }} resizeMode="contain" accessibilityIgnoresInvertColors />
      <T v="display" style={{ fontSize: 18, color: on ? t.hue : COLORS.text, letterSpacing: 1 }}>
        {t.name.toUpperCase()}
      </T>
      {on ? <Corners color={t.hue} size={8} /> : null}
    </Pressable>
  );
}

function CardDetail({ t, pay, setPay }: { t: CardTier; pay: 'SKR' | 'ORE'; setPay: (p: 'SKR' | 'ORE') => void }) {
  return (
    <TechPanel title={`${t.name.toUpperCase()} CARD`} color={t.hue}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Image source={cardArt(t.value)} style={{ width: 96, height: Math.round(96 * CARD_RATIO) }} resizeMode="contain" />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="display" style={{ fontSize: 34, lineHeight: 34, color: COLORS.gold }}>${t.value}</T>
          <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>PAID IN SKR OR ORE</T>
        </View>
      </View>
      <View style={{ gap: 5, marginTop: 10 }}>
        <T v="tiny" style={{ color: t.hue, letterSpacing: 1 }}>IN THIS CARD</T>
        {perkLines(t).map((line, i) => (
          <View key={line} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <PixIcon name={i === 0 ? 'bot' : line.includes('item') ? 'gift' : line.includes('NUGS') ? 'nugs' : line.includes('XP') ? 'star' : 'sparkle'} size={16} />
            <T style={{ flex: 1, fontSize: 13 }}>{line}</T>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 12 }}>
        {(['SKR', 'ORE'] as const).map((p) => (
          <TechTab key={p} label={`PAY ${p}`} on={pay === p} onPress={() => setPay(p)} color={t.hue} />
        ))}
      </View>
      <TechBtn
        label={CARDS_FOR_SALE ? `BUY WITH ${pay}` : 'OPENS WITH THE MARKET'}
        primary
        disabled={!CARDS_FOR_SALE}
        color={t.hue}
        style={{ marginTop: 8 }}
      />
      <T v="muted" style={{ fontSize: 11, lineHeight: 15, marginTop: 8 }}>
        The SOL amount is fixed when you buy, at that day's SOL price. Items arrive when the Gali NFT market opens. Mining can return less than you put in.
      </T>
    </TechPanel>
  );
}

/** Renders its child with the box's own width once laid out. */
function Measure({ children, style }: { children: (w: number) => React.ReactNode; style?: object }) {
  const [w, setW] = useState(0);
  return (
    <View style={style} onLayout={(e) => setW(Math.floor(e.nativeEvent.layout.width))}>
      {w > 0 ? children(w) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  redeemRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: U, borderColor: 'rgba(34,53,111,0.6)', borderStyle: 'dashed' },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, padding: 8, gap: 2, alignItems: 'center' },
  bagCard: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, borderWidth: U, backgroundColor: TECH.panel },
  mining: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 8, marginVertical: 6, borderWidth: U },
  bar: { height: 8, backgroundColor: TECH.ink, borderWidth: U, borderColor: TECH.rule, overflow: 'hidden' },
  intro: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 10, borderWidth: U, borderColor: TECH.rule, backgroundColor: TECH.panel },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { alignItems: 'center', gap: 4, paddingTop: 6, paddingBottom: 8, borderWidth: U },
});

/* ---------------- redeeming a card: the mining panel's row, the code window and the summary ---------------- */

/** The code window: open from the mining panel or from a card in the Bag (with its code filled in). */
export const useRedeem = create<{ open: boolean; code: string; show: (code?: string) => void; hide: () => void }>((set) => ({
  open: false,
  code: '',
  show: (code = '') => set({ open: true, code }),
  hide: () => set({ open: false, code: '' }),
}));

/** One row in the mining panel: use a Mining Card code, claim it, or watch the card's run mine. */
export function RedeemCardRow() {
  const owner = useGame((s) => s.wallet.owner);
  const busy = useGame((s) => s.wallet.busy);
  const run = useCardRun((s) => s.run);
  if (!owner) return null;
  if (run?.state === 'running') return <CardMining />;
  const t = run ? tierOf(run.value) : null;
  const status = run
    ? run.state === 'pending'
      ? `$${run.value} card: waiting for its SOL`
      : run.state === 'ready'
        ? `$${run.value} card ready: ${run.rounds} rounds`
        : `$${run.value} card: finished`
    : null;
  return (
    <View style={styles.redeemRow}>
      {t ? <Image source={cardArt(t.value)} style={{ width: 22, height: Math.round(22 * CARD_RATIO) }} resizeMode="contain" /> : <PixIcon name="gem" size={18} />}
      <T style={{ flex: 1, fontSize: 13, color: status ? COLORS.gold : TECH.dim }} numberOfLines={1}>
        {status ?? 'Have a Mining Card?'}
      </T>
      {run?.state === 'done' ? (
        <TechBtn small label="RESULTS" color={COLORS.gold} onPress={() => useCardRun.setState({ summary: true })} />
      ) : run?.state === 'ready' ? (
        <TechBtn small primary label="CLAIM NOW" color={COLORS.gold} disabled={Boolean(busy)} onPress={() => void claimCard()} />
      ) : !run ? (
        <TechBtn small label="ENTER CODE" color={COLORS.gold} onPress={() => useRedeem.getState().show()} />
      ) : null}
    </View>
  );
}

/** The card's run in the mining panel: its card looping, a swinging pick, a progress bar and the time left. */
function CardMining() {
  const run = useCardRun((s) => s.run);
  const swing = useRef(new Animated.Value(0)).current;
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: 1, duration: 450, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 0, duration: 550, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    const id = setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => {
      loop.stop();
      clearInterval(id);
    };
  }, [swing]);
  if (!run) return null;
  const t = tierOf(run.value);
  const pct = run.rounds ? Math.min(1, run.played / run.rounds) : 0;
  const leftMin = Math.max(1, Math.ceil(((run.rounds - run.played) * CARD_ROUND_SECS) / 60));
  const eta = leftMin >= 60 ? `~${Math.floor(leftMin / 60)}h ${leftMin % 60}m left` : `~${leftMin} min left`;
  const rot = swing.interpolate({ inputRange: [0, 1], outputRange: ['-35deg', '35deg'] });
  const hue = t?.hue ?? COLORS.gold;
  return (
    <View style={[styles.mining, { borderColor: alpha(hue, 0.5), backgroundColor: alpha(hue, 0.08) }]}>
      {t ? <Image source={cardArt(t.value)} style={{ width: 46, height: Math.round(46 * CARD_RATIO) }} resizeMode="contain" /> : null}
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Animated.View style={{ transform: [{ rotate: rot }] }}>
            <PixIcon name="pick" size={18} />
          </Animated.View>
          <T v="display" style={{ fontSize: 18, color: hue, flex: 1 }} numberOfLines={1}>
            MINING{'.'.repeat(dots)}
          </T>
          <T v="num" style={{ fontSize: 14, color: COLORS.text }}>
            {run.played}/{run.rounds}
          </T>
        </View>
        <View style={styles.bar}>
          <View style={{ width: `${Math.round(pct * 100)}%`, height: '100%', backgroundColor: hue }} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <T v="tiny" style={{ color: TECH.dim }}>{t ? `${t.name.toUpperCase()} CARD` : 'CARD'} · {run.ore.toFixed(run.ore < 0.01 ? 5 : 3)} ORE</T>
          <T v="tiny" style={{ color: TECH.dim }}>{eta}</T>
        </View>
      </View>
    </View>
  );
}

/** The card comes out of its pack: it flies in small and turned, flips to face you, then glows. */
function CardReveal({ t }: { t: CardTier }) {
  const a = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 900, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1000, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0, duration: 1000, useNativeDriver: true }),
        ]),
      ),
    ]).start();
    play('select');
  }, [a, glow]);
  const w = 168;
  const h = Math.round(w * CARD_RATIO);
  return (
    <View style={{ width: w + 40, height: h + 30, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', width: w + 36, height: h + 26, backgroundColor: alpha(t.hue, 0.28), opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }}
      />
      <Animated.View
        style={{
          opacity: a.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
          transform: [
            { perspective: 800 },
            { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
            { rotateY: a.interpolate({ inputRange: [0, 1], outputRange: ['540deg', '0deg'] }) },
          ],
        }}
      >
        <Image source={cardArt(t.value)} style={{ width: w, height: h }} resizeMode="contain" />
      </Animated.View>
    </View>
  );
}

/** The code window and the end-of-run summary. Mounted once, at the app's root. */
export function CardHosts() {
  const open = useRedeem((s) => s.open);
  const summary = useCardRun((s) => s.summary);
  return (
    <>
      {open ? <RedeemWindow /> : null}
      {summary ? <CardSummary /> : null}
    </>
  );
}

function RedeemWindow() {
  const start = useRedeem((s) => s.code);
  const hide = useRedeem((s) => s.hide);
  const owner = useGame((s) => s.wallet.owner);
  const [code, setCode] = useState(start);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ value: number; sol: number; xp: number; nugs: number; items: string; paid: boolean } | null>(null);
  const submit = async () => {
    if (busy) return;
    setErr('');
    const c = cleanCode(code);
    if (!c) return setErr('A code reads GALI-XXXX-XXXX-XXXX.');
    if (!owner || playWallet() !== owner) return setErr('Connect your wallet and sign in first (chat or play a round).');
    if (useCardRun.getState().run && useCardRun.getState().run?.state !== 'done') return setErr('Finish the card that is running first.');
    setBusy(true);
    try {
      const r = await playRedeem(c);
      if ('error' in r) return setErr(r.error);
      play('select');
      setDone({
        value: r.value,
        sol: r.sol_lamports / 1e9,
        xp: r.rewards?.xp ?? 0,
        nugs: r.rewards?.nugs ?? Math.floor((r.rewards?.xp ?? 0) / 10),
        items: (r.rewards?.items ?? []).map((i) => `${i.n} ${i.rarity}`).join(', '),
        paid: Boolean(r.payout),
      });
      beginCardRun(r.code, r.value, r.sol_lamports, Boolean(r.payout));
      void useSkills.getState().refresh();
    } finally {
      setBusy(false);
    }
  };
  const t = done ? tierOf(done.value) : null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={hide}>
      <Scrim onPress={hide}>
        <Window title={done ? 'CARD USED' : 'USE A MINING CARD'} sub={done ? undefined : 'Enter the code from your card. It funds an autopilot run and opens its free pack.'} onClose={hide} width={420} accent={COLORS.gold}>
          {done && t ? (
            <View style={{ gap: 10, alignItems: 'center' }}>
              <CardReveal t={t} />
              <T v="display" style={{ fontSize: 24, color: t.hue }}>{t.name.toUpperCase()} CARD</T>
              <T style={{ textAlign: 'center' }}>+{done.xp.toLocaleString()} XP and +{done.nugs.toLocaleString()} NUGS added. {done.items ? `${done.items} items arrive when the NFT market opens.` : ''}</T>
              <T style={{ textAlign: 'center', color: COLORS.teal }}>
                {done.paid ? `${done.sol.toFixed(4)} SOL ready to mine.` : `${done.sol.toFixed(4)} SOL is on its way from Gali. CLAIM NOW lights up in the mining panel when it lands.`}
              </T>
              {done.paid ? (
                <Btn
                  kind="gold"
                  label="CLAIM NOW"
                  onPress={() => {
                    hide();
                    void claimCard();
                  }}
                />
              ) : (
                <Btn kind="gold" label="Done" onPress={hide} />
              )}
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <TextInput
                value={code}
                onChangeText={(v) => {
                  setCode(v.toUpperCase());
                  setErr('');
                }}
                onSubmitEditing={() => void submit()}
                placeholder="GALI-XXXX-XXXX-XXXX"
                placeholderTextColor={COLORS.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={24}
                style={[INPUT, { width: '100%', textAlign: 'center', fontSize: 20, letterSpacing: 2 }]}
              />
              {err ? <T style={{ color: COLORS.red, textAlign: 'center' }}>{err}</T> : null}
              <Btn kind="gold" label={busy ? 'Checking…' : 'USE CARD'} disabled={busy} onPress={() => void submit()} />
              <Btn
                kind="ghost"
                small
                label="See Mining Cards in the Market"
                onPress={() => {
                  hide();
                  useMarket.getState().show(undefined, 'cards');
                }}
              />
            </View>
          )}
        </Window>
      </Scrim>
    </Modal>
  );
}

function CardSummary() {
  const run = useCardRun((s) => s.run);
  const close = useCardRun((s) => s.closeSummary);
  if (!run) return null;
  const t = tierOf(run.value);
  const net = run.solOut - run.solIn;
  const stat = (k: string, v: string, color: string = COLORS.text) => (
    <PixelBox fill="rgba(6,10,28,0.9)" hi="#22356f" lo="#04060f" style={styles.stat}>
      <T v="display" style={{ fontSize: 26, lineHeight: 28, color }}>{v}</T>
      <T v="tiny" style={{ color: TECH.dim, letterSpacing: 1 }}>{k}</T>
    </PixelBox>
  );
  return (
    <Modal transparent visible animationType="fade" onRequestClose={close}>
      <Scrim onPress={close}>
        <Window title="CARD RUN COMPLETE" sub={t ? `Your ${t.name} card ($${run.value}) mined ${run.played} round${run.played === 1 ? '' : 's'}.` : undefined} onClose={close} width={460} accent={COLORS.gold}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            {t ? <Image source={cardArt(t.value)} style={{ width: 90, height: Math.round(90 * CARD_RATIO) }} resizeMode="contain" /> : null}
            <View style={{ flex: 1, gap: 8 }}>
              <View style={styles.stats}>
                {stat('ORE MINED', run.ore.toFixed(run.ore < 0.01 ? 5 : 3), COLORS.gold)}
                {stat('GOLD SPOT WINS', String(run.wins), COLORS.green)}
              </View>
              <View style={styles.stats}>
                {stat('SOL IN', run.solIn.toFixed(4))}
                {stat('SOL BACK', run.solOut.toFixed(4), COLORS.teal)}
              </View>
            </View>
          </View>
          <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
            {net >= 0 ? `+${net.toFixed(4)}` : net.toFixed(4)} SOL from the rounds, plus the ORE. SOL back and ORE wait in Unclaimed in the mining panel.
          </T>
          <Btn kind="gold" label="Nice" onPress={close} />
        </Window>
      </Scrim>
    </Modal>
  );
}

/* ---------------- the Bag: cards you bought and haven't used ---------------- */

export function BagCards() {
  const owner = useGame((s) => s.wallet.owner);
  const [cards, setCards] = useState<OwnedCard[] | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const toast = useGame((s) => s.toast);
  useEffect(() => {
    if (!owner) return;
    let live = true;
    void playCards().then((r) => live && setCards(r?.unused ?? []));
    return () => {
      live = false;
    };
  }, [owner]);
  const copy = (code: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(code).then(() => toast('Card code copied', 'good'), () => toast(code, 'info'));
    } else toast(code, 'info');
  };
  return (
    <TechPanel title="MINING CARDS" color={COLORS.gold} right={cards?.length ? <T v="tiny" style={{ color: COLORS.gold }}>{cards.length} UNUSED</T> : undefined}>
      {!owner ? (
        <T v="muted">Connect your wallet to see your cards.</T>
      ) : cards === null ? (
        <T v="muted">Loading…</T>
      ) : cards.length === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={cardArt(10)} style={{ width: 54, height: Math.round(54 * CARD_RATIO), opacity: 0.45 }} resizeMode="contain" />
          <View style={{ flex: 1, gap: 6 }}>
            <T style={{ fontSize: 13 }}>No unused cards. A Mining Card funds an autopilot run and comes with a free pack.</T>
            <TechBtn small label="SEE CARDS" color={COLORS.gold} onPress={() => useMarket.getState().show(undefined, 'cards')} style={{ alignSelf: 'flex-start' }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {cards.map((c) => {
            const t = tierOf(c.value);
            if (!t) return null;
            return (
              <View key={c.code} style={[styles.bagCard, { borderColor: alpha(t.hue, 0.5) }]}>
                <Image source={cardArt(t.value as CardValue)} style={{ width: 64, height: Math.round(64 * CARD_RATIO) }} resizeMode="contain" />
                <View style={{ flex: 1, gap: 4 }}>
                  <T v="display" style={{ fontSize: 20, color: t.hue }}>{t.name.toUpperCase()} · ${t.value}</T>
                  <T selectable style={{ fontSize: 13, letterSpacing: 1 }}>{shown === c.code ? c.code : maskCode(c.code)}</T>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    <TechBtn small primary label="USE NOW" color={COLORS.gold} onPress={() => useRedeem.getState().show(c.code)} />
                    <TechBtn small label={shown === c.code ? 'HIDE' : 'SHOW CODE'} onPress={() => setShown(shown === c.code ? null : c.code)} />
                    <TechBtn small label="COPY" onPress={() => copy(c.code)} />
                  </View>
                </View>
              </View>
            );
          })}
          <T v="muted" style={{ fontSize: 11 }}>A code works once, for any wallet: you can give a card to a friend.</T>
        </View>
      )}
    </TechPanel>
  );
}
