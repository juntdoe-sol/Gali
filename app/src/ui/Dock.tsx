import { layoutNow } from './layout';
import { FEATURE_AI_MINING, FEATURE_GALI_PROGRAM } from '../config/features';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CLUSTER, PLATFORM_FEE_BPS, REFINING_FEE, short } from '../chain/light';
import { BLOCKS, boostFor, COLORS, pointsFor } from '../game/constants';
import { watchMotion } from '../game/motion';
import { DEFAULT_SMART, fmtSol, liveReturn, maskOf, randomPick, MIN_SOL_PER_BLOCK, SMART_COUNTS } from '../game/pot';
import { isLive, isOnChain, soloOf, useGame, type DockTab, type Preset } from '../game/store';
import { fx } from '../pixel/fx';
import { play } from '../game/sfx';
import { useView } from '../pixel/view';
import { Btn, F, FocusRing, ModalCenter, PixelBox, Scrim, T, Tip, U, Window } from './kit';
import { BAR_H } from './TabBar';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { useLayout } from './layout';
import { openScanTv, TV_PAIR } from './TvLink';
import { evOf } from '../game/ev';
import { refreshMarket, useOreStats } from '../game/oreStats';
import { botAllowed, buyPass, DEFAULT_BOT_SETTINGS, loadRoundNow, loadRounds, type AiRoundRow, type RoundNow, loadLog, netSol, refreshAi, saveBotSettings, sendFeedback, startTrial, useAi, type AiLogEntry, type AiStyle, type AiVote, type BotMode, type BotSettings } from '../game/aiMining';

const SHAKE_G = 2.1;
const layoutNowDesktop = () => layoutNow().desktop;
const TABS: { id: DockTab; label: string }[] = [
  { id: 'lite', label: 'LITE' },
  { id: 'pro', label: 'PRO' },
  ...(FEATURE_AI_MINING ? [{ id: 'ai' as const, label: 'BOT' }] : []),
];

export function Dock({ embedded, noUnclaimed, scroll }: { embedded?: boolean; noUnclaimed?: boolean; scroll?: { headStyle?: StyleProp<ViewStyle>; bodyStyle?: StyleProp<ViewStyle> } } = {}) {
  const insets = useSafeAreaInsets();
  const tab = useGame((s) => s.dockTab);
  const run = useGame((s) => s.run);
  const setTab = useGame((s) => s.setDockTab);
  const open = useGame((s) => s.dockOpen);
  const setOpen = useGame((s) => s.setDockOpen);
  const compact = false;
  const inside = useView((s) => s.focus >= 0);
  const { height: winH } = useWindowDimensions();

  // shake the phone to Smart-pick a random set of spots
  useEffect(() => {
    let last = 0;
    return watchMotion(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      if (g > SHAKE_G && Date.now() - last > 2500) {
        last = Date.now();
        useGame.getState().shakePick();
      }
    });
  }, []);

  const barTop = BAR_H + insets.bottom;
  // closed: the map frames itself down to the bottom bar
  useEffect(() => {
    if (!open && !embedded) fx.viewBottom = barTop + 6;
  }, [open, barTop, embedded]);
  if (!open && !embedded) return null;

  const head = (
    <View style={styles.head}>
      <View style={styles.seg} accessibilityRole="tablist">
        {TABS.map((t) => {
          const on = tab === t.id;
          return (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={styles.segBtn} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${t.label} mode`}>
              {(st) => {
                const { hovered, focused } = st as { hovered?: boolean; focused?: boolean };
                return (
                  <>
                    {on ? <PixelBox fill="#2e4d94" hi="#5f86d8" lo="#1b2f63" style={StyleSheet.absoluteFill} /> : hovered ? <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.05)' }]} /> : null}
                    <T v="display" style={{ fontSize: 18, lineHeight: 20, letterSpacing: 2, color: on ? COLORS.gold : hovered ? COLORS.text : COLORS.muted }}>
                      {t.label}
                    </T>
                    {run?.kind === t.id ? <View style={styles.runDot} /> : null}
                    {focused ? <FocusRing /> : null}
                  </>
                );
              }}
            </Pressable>
          );
        })}
      </View>
      {embedded ? null : (
        <Pressable onPress={() => setOpen(false)} style={styles.fold} accessibilityRole="button" accessibilityLabel="Close the mine panel">
          <PixelBox fill="rgba(8,13,32,0.9)" hi="#2d4282" lo="#04060f" style={StyleSheet.absoluteFill} />
          <T v="display" style={{ fontSize: 18, color: COLORS.gold, transform: [{ rotate: '90deg' }] }}>
            {'>'}
          </T>
        </Pressable>
      )}
    </View>
  );

  const botSwitch = tab === 'ai' && FEATURE_AI_MINING ? <BotModeSwitch /> : null;
  if (embedded) {
    const body = (
      <>
        {noUnclaimed ? null : <UnclaimedRow />}
        {tab === 'lite' ? <DeskLite /> : tab === 'ai' && FEATURE_AI_MINING ? <AiPanel /> : <DeskPro />}
      </>
    );
    // scroll: the tabs and the Bot switch stay put while the panel under them scrolls
    return scroll && tab !== 'ai' ? (
      <View style={[styles.embedded, { flexShrink: 1, minHeight: 0 }]}>
        <View style={scroll.headStyle}>
          {head}
          {botSwitch}
        </View>
        <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={scroll.bodyStyle} showsVerticalScrollIndicator>
          {body}
        </ScrollView>
      </View>
    ) : (
      <View style={styles.embedded}>
        {head}
        {botSwitch}
        {body}
      </View>
    );
  }

  return (
    <View
      style={[styles.dock, { bottom: barTop, paddingBottom: 10 }, inside && { display: 'none' }]}
      onLayout={(e) => {
        fx.viewBottom = e.nativeEvent.layout.height + barTop + 10;
      }}
    >
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.dockFill, { top: 0, left: U, right: U, backgroundColor: '#04060f' }]} />
        <View style={[styles.dockFill, { top: U, left: 0, right: 0, backgroundColor: '#04060f' }]} />
        <View style={[styles.dockFill, { top: U, left: U, right: U, backgroundColor: 'rgba(17,27,60,0.97)' }]} />
        <View style={[styles.dockFill, { top: U, left: U, right: U, height: U, bottom: undefined, backgroundColor: COLORS.trim }]} />
        <View style={[styles.dockFill, { top: U * 2, left: U, right: U, height: U, bottom: undefined, backgroundColor: '#33498c' }]} />
      </View>
      <Pressable onPress={() => setOpen(false)} hitSlop={8} style={styles.handle} accessibilityRole="button" accessibilityLabel="Close the mine panel">
        <View style={styles.handleBar} />
      </Pressable>
      {head}
      {botSwitch}
      <UnclaimedRow />
      {tab === 'ai' && FEATURE_AI_MINING ? (
        // compact enough to fit without scrolling; the learning log and feedback pop up as cards
        <AiPanel />
      ) : tab === 'lite' ? (
        <LitePanel compact={compact} />
      ) : (
        <ProPanel compact={compact} />
      )}
    </View>
  );
}

/* ---------------- shared bits ---------------- */
const RETURN_INFO =
  "ORE keeps 1% of every spot and 10% more of spots that miss. The rest of your SOL comes back to claim. Covering all 25 spots means you always hit, so you mine every round, but you pay the 10% on the 24 spots that miss.";

const LIVE_INFO =
  "Only the gold spot mines ORE: split by SOL there, or all to one miner on a ★ solo spot, with odds equal to their share. ORE keeps 1% of every spot and 10% more of spots that miss. The rest of your SOL comes back to claim. One round in 500 also pays ORE's motherlode, split by SOL on the gold spot.";

/** Unclaimed SOL and SKR from finished rounds, each with its own Claim button. */
export function UnclaimedRow({ boxed }: { boxed?: boolean } = {}) {
  const onChain = useGame(isOnChain);
  const sol = useGame((s) => (onChain ? s.wallet.unclaimed.sol : (s.save.practiceUnclaimedSol ?? 0)));
  const unrefined = useGame((s) => (onChain ? s.wallet.unclaimed.unrefined : (s.save.practiceUnclaimedSkr ?? 0)));
  const refined = useGame((s) => (onChain ? s.wallet.unclaimed.refined : (s.save.practiceRefinedSkr ?? 0)));
  const busy = useGame((s) => s.wallet.busy);
  const claim = useGame((s) => s.claimRewards);
  const fee = useGame((s) => (onChain ? s.wallet.unclaimed.fee : (s.save.practiceUnclaimedSkr ?? 0) * REFINING_FEE));
  const holdTipOff = useGame((s) => Boolean(s.save.holdTipOff));
  const [askHold, setAskHold] = useState(false);
  // claiming unrefined ORE pays ORE's 10% to everyone still holding: say so, in a fun way, before it happens
  const claimOre = () => {
    if (unrefined > 0.0000001 && !holdTipOff) {
      play('pop');
      setAskHold(true);
    } else void claim('skr');
  };
  // nothing to claim yet: give the island the room. Any ORE at all shows: one autopilot round can mine well under 0.005
  if (sol < 0.00005 && unrefined + refined <= 0) return null;
  const body = (
    <View style={[styles.unclaimed, boxed && styles.unclaimedBoxed]} accessibilityLabel={`Unclaimed ${sol.toFixed(4)} SOL, ${Math.floor(unrefined)} unrefined ORE, ${Math.floor(refined)} refined ORE`}>
      <View style={styles.uRow}>
        <PixIcon name="gift" size={18} />
        <T v="label" style={{ color: COLORS.gold }}>
          Unclaimed
        </T>
        <Info
          text={`Finished rounds credit your SOL and the ORE you mined here${onChain ? ' (held by ORE for your wallet)' : ''}. SOL claims are free. Unrefined ORE pays ORE's own 10% fee when you claim it, and that fee is shared with everyone still holding theirs, as refined ORE you can claim with no fee. The longer you hold, the more refined ORE you collect.`}
        />
        <T v="num" numberOfLines={1} style={{ flex: 1, fontSize: 16, color: COLORS.sol, textAlign: 'right' }}>
          {fmtSol(sol)} SOL
        </T>
        <Chip label="CLAIM" on={sol > 0} disabled={!(sol > 0) || Boolean(busy)} onPress={() => void claim('sol')} />
      </View>
      <View style={styles.uRow}>
        <T v="num" numberOfLines={1} style={{ flex: 1, fontSize: 14, color: COLORS.muted }}>
          {fmtAmt(unrefined)} unrefined · +{fmtAmt(refined)} refined
          {fee > 0.00005 ? ` · fee ${fmtAmt(fee)}` : ''}
        </T>
        <T v="num" numberOfLines={1} style={{ fontSize: 16, color: COLORS.skr }}>
          {fmtAmt(unrefined - fee + refined)} ORE
        </T>
        <Chip label="CLAIM" on={unrefined + refined > 0} disabled={!(unrefined + refined > 0) || Boolean(busy)} onPress={claimOre} />
      </View>
      {askHold ? <HoldPrompt unrefined={unrefined} refined={refined} fee={fee} onKeep={() => setAskHold(false)} onClaim={() => { setAskHold(false); void claim('skr'); }} /> : null}
    </View>
  );
  if (!boxed) return body;
  // floating on its own over the map (desktop island): give it a panel of its own
  return (
    <PixelBox fill="rgba(15,23,52,0.95)" hi="#33498c" lo="#0c1430" shadow={2} style={{ padding: 8 }}>
      {body}
    </PixelBox>
  );
}

/** "Wait, miner!": ORE's refining fee explained at the moment it would be paid, with the choice to keep holding. */
function HoldPrompt({ unrefined, refined, fee, onKeep, onClaim }: { unrefined: number; refined: number; fee: number; onKeep: () => void; onClaim: () => void }) {
  const off = useGame((s) => Boolean(s.save.holdTipOff));
  const setOff = useGame((s) => s.setHoldTipOff);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onKeep}>
      <Scrim onPress={onKeep}>
        <ModalCenter>
          <Window title="WAIT, MINER!" sub="Your unrefined ORE is still earning" accent={COLORS.gold} onClose={onKeep} width={440}>
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 4 }}>
              <PixIcon name="ore" size={56} />
              <T style={{ textAlign: 'center', fontSize: 15, lineHeight: 21 }}>
                Every miner who claims unrefined ORE pays ORE's 10% refining fee. That fee is shared out to everyone still holding, as refined ORE that claims free.
              </T>
              <T v="display" style={{ textAlign: 'center', fontSize: 20, lineHeight: 22, color: COLORS.gold }}>
                Hold, and other miners' claims pay you.
              </T>
            </View>
            <View style={styles.holdRows}>
              <View style={styles.holdRow}>
                <T v="muted">Claim now, refining fee</T>
                <T v="num" style={{ fontSize: 17, color: COLORS.red }}>-{fmtAmt(fee)} ORE</T>
              </View>
              <View style={styles.holdRow}>
                <T v="muted">Refined ORE earned so far</T>
                <T v="num" style={{ fontSize: 17, color: COLORS.skr }}>+{fmtAmt(refined)} ORE</T>
              </View>
              <View style={styles.holdRow}>
                <T v="muted">Unrefined ORE you hold</T>
                <T v="num" style={{ fontSize: 17 }}>{fmtAmt(unrefined)} ORE</T>
              </View>
            </View>
            <Btn kind="gold" label="KEEP HOLDING" sub="Earn from every claim" onPress={onKeep} style={{ marginTop: 12 }} />
            <Btn kind="plain" label="CLAIM ANYWAY" sub={`Pay ${fmtAmt(fee)} ORE now`} onPress={onClaim} style={{ marginTop: 8 }} />
            <Pressable onPress={() => setOff(!off)} accessibilityRole="checkbox" accessibilityState={{ checked: off }} style={styles.holdCheck}>
              <View style={[styles.holdBox, off && { backgroundColor: COLORS.gold }]} />
              <T v="muted" style={{ fontSize: 13 }}>Don't remind me again</T>
            </Pressable>
          </Window>
        </ModalCenter>
      </Scrim>
    </Modal>
  );
}

/** Small ORE amounts keep their decimals; big practice numbers stay whole. */
const fmtAmt = (v: number) => (v >= 100 ? Math.floor(v).toLocaleString() : v.toFixed(v >= 1 ? 2 : v >= 0.01 ? 4 : 6));

/** SOL kept back in live mode for fees and ORE's miner account rent. */
const LIVE_FEE_SOL = 0.008;

function useBalance() {
  const sol = useGame((s) => s.wallet.sol + s.wallet.sessionSol);
  const practice = useGame((s) => s.save.practiceSol);
  const onChain = useGame(isOnChain);
  const live = useGame(isLive);
  // live: what a round can use, after fees
  return { onChain, live, balance: onChain ? Math.max(0, sol - (live ? LIVE_FEE_SOL : 0)) : practice };
}

function Info({ text }: { text: string }) {
  const toast = useGame((s) => s.toast);
  const { mouse } = useLayout();
  const btn = (
    <Pressable onPress={() => toast(text, 'info')} hitSlop={10} accessibilityLabel={`More info: ${text}`} style={styles.info}>
      <PixIcon name="info" size={16} style={{ opacity: 0.85 }} />
    </Pressable>
  );
  return mouse ? (
    <Tip text={text} side="top" width={280}>
      {btn}
    </Tip>
  ) : (
    btn
  );
}

function Row({ icon, label, info, right, last }: { icon: PixName; label: string; info?: string; right: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.line, last && { borderBottomWidth: 0 }]}>
      <View style={styles.lineLeft}>
        <PixIcon name={icon} size={18} />
        <T v="label" style={{ color: COLORS.text }}>
          {label}
        </T>
        {info ? <Info text={info} /> : null}
      </View>
      <View style={styles.lineRight}>{right}</View>
    </View>
  );
}

function Chip({ label, on, onPress, disabled, grow }: { label: string; on?: boolean; onPress: () => void; disabled?: boolean; grow?: boolean }) {
  return (
    <Pressable onPress={() => {
      play('button');
      onPress();
    }} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: Boolean(on), disabled: Boolean(disabled) }} style={[grow && styles.chipGrow, disabled && { opacity: 0.4 }]}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        const hot = hovered && !disabled;
        return (
          <PixelBox
            fill={on ? 'rgba(255,201,60,0.16)' : hot ? '#1a2a58' : '#0b1430'}
            hi={on ? COLORS.gold : hot ? '#4a68b8' : '#22356f'}
            lo={on ? '#7a3d06' : '#04060f'}
            edge={on ? '#2a1400' : '#04060f'}
            style={[styles.chip, { transform: [{ translateY: pressed ? U : 0 }] }]}
          >
            <T v="display" numberOfLines={1} style={{ fontSize: 16, lineHeight: 17, color: on ? COLORS.gold : hot ? COLORS.text : COLORS.muted, textAlign: 'center', letterSpacing: 0.6 }}>
              {label}
            </T>
            {focused ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

const trim = (v: number) => (v > 0 ? String(Math.floor(v * 1e4) / 1e4) : '');
/** a + b on a typed amount, without float dust (0.1 + 0.01 = 0.11, not 0.11000000000000001) */
const addTo = (cur: string, v: number) => String(Math.round(((Number(cur) || 0) + v) * 1e4) / 1e4);
const cleanAmt = (t: string) => t.replace(',', '.').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
/** ORE charges each autopilot round its executor's network fee */
const EXEC_FEE = 0.00001;

function RunButton({ ready, label, sub, onStart }: { ready: boolean; label: string; sub?: string; onStart: () => void }) {
  const run = useGame((s) => s.run);
  const stop = useGame((s) => s.stopRun);
  const busy = useGame((s) => s.wallet.busy);
  if (run)
    return (
      <Btn
        kind="red"
        label={`STOP · ${run.total - run.left}/${run.total} rounds`}
        sub={`${fmtSol(run.perRound)} SOL a round · ${run.kind.toUpperCase()}`}
        onPress={stop}
        style={{ marginTop: 10 }}
      />
    );
  const start = () => {
    onStart();
    // a phone folds the panel away to show the dig; the desktop panel stays where it is
    if (!layoutNowDesktop()) useGame.getState().setDockOpen(false);
  };
  return <Btn kind={ready ? 'gold' : 'plain'} label={busy ?? label} sub={sub} onPress={start} disabled={!ready || Boolean(busy)} style={{ marginTop: 10, minHeight: 54 }} />;
}

/** ORE-style big amount: type it, or build it with the +0.01 / +0.1 / +1 / MAX chips below. */
function BigAmount({ value, onChange, hint, disabled }: { value: string; onChange: (v: string) => void; hint: string; disabled?: boolean }) {
  const { balance, live, onChain } = useBalance();
  const empty = !(Number(value) > 0);
  return (
    <View style={styles.big}>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(cleanAmt(t))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={COLORS.muted}
        editable={!disabled}
        selectTextOnFocus
        style={[styles.bigInput, empty && { color: COLORS.muted }]}
        accessibilityLabel={hint}
        numberOfLines={1}
      />
      <View style={styles.bigBal} accessibilityLabel={`Wallet ${balance.toFixed(4)} SOL`}>
        <PixIcon name="sol" size={16} />
        <T v="num" style={{ fontSize: 16, color: COLORS.muted }}>
          {balance.toFixed(4)} {live || onChain ? 'SOL' : 'practice SOL'}
        </T>
      </View>
    </View>
  );
}

function QuickAdd({ onAdd, onMax, disabled }: { onAdd: (v: number) => void; onMax: () => void; disabled?: boolean }) {
  return (
    <View style={[styles.lineRight, { marginTop: 4, marginBottom: 4 }]}>
      {[0.01, 0.1, 1].map((v) => (
        <Chip key={v} grow label={`+${v}`} onPress={() => onAdd(v)} disabled={disabled} />
      ))}
      <Chip grow label="MAX" onPress={onMax} disabled={disabled} />
    </View>
  );
}

function Stepper({ value, onMinus, onPlus, disabled, label }: { value: number; onMinus: () => void; onPlus: () => void; disabled?: boolean; label: string }) {
  return (
    <>
      <Chip label="−" onPress={onMinus} disabled={disabled} />
      <View accessible accessibilityLabel={`${value} ${label}`}>
        <T v="num" style={{ fontSize: 18, minWidth: 28, textAlign: 'center' }}>
          {value}
        </T>
      </View>
      <Chip label="+" onPress={onPlus} disabled={disabled} />
    </>
  );
}

function AutopilotRow() {
  const live = useGame(isLive);
  const autopilot = useGame((s) => s.autopilot);
  const busy = useGame((s) => s.wallet.busy);
  if (!live || !autopilot) return null;
  return (
    <Row
      icon="bot"
      label={autopilot.ai ? 'Bot on' : 'Autopilot on'}
      info={
        autopilot.ai
          ? "Your SOL sits in ORE's automation. Your bot picks the spots and plays them for you, at most your limit per spot, and can't take the SOL out. Stopping closes it and sends what is left back to your wallet."
          : "Your SOL sits in ORE's automation and is deployed round by round, even with the app closed (0.00001 SOL a round covers the network fee). Stopping closes it and sends what is left back to your wallet."
      }
      right={
        <>
          <T v="num" style={{ fontSize: 15, color: COLORS.teal, marginRight: 6 }}>
            {fmtSol(autopilot.balance)} SOL left
          </T>
          <Chip label="STOP" onPress={() => void useGame.getState().stopAutopilot()} disabled={Boolean(busy)} />
        </>
      }
    />
  );
}

/* ---------------- RIGHT BAR (desktop ORE Island) LITE, like ORE: one amount, 0.01 SOL a round on all 25 spots ---------------- */

/**
 * Round signal: is a SOL put on these spots right now worth more than it costs, on average (+EV), or less (-EV)?
 * Worked out from ORE's payout rules, the SOL already on each spot, the motherlode and today's ORE/SOL price.
 * `perSpot` 0 means the player has not entered an amount yet: the signal is then for a small reference stake.
 */
const EV_REF_PER_SPOT = 0.0004;
function EvRow({ squares, perSpot }: { squares: number[]; perSpot: number }) {
  const live = useGame(isLive);
  const roundId = useGame((s) => s.roundId);
  const pot = useGame((s) => s.pot);
  const orePool = useGame((s) => s.wallet.orePool);
  const market = useOreStats((s) => s.market);
  useEffect(() => {
    if (!live) return;
    void refreshMarket();
    const id = setInterval(() => void refreshMarket(), 5 * 60_000);
    return () => clearInterval(id);
  }, [live]);
  if (!live) return null;
  const ref = !(perSpot > 0);
  const stake = ref ? EV_REF_PER_SPOT : perSpot;
  const spots = squares.length ? squares : [...Array(BLOCKS).keys()];
  const onBoard = pot.roundId === roundId ? pot.perBlock : Array(BLOCKS).fill(0);
  const price = market?.oreUsd && market.solUsd ? market.oreUsd / market.solUsd : 0;
  const e = evOf(onBoard, spots, stake, orePool, price, Number(PLATFORM_FEE_BPS));
  const plus = e ? e.ev >= 0 : false;
  const pct = e ? `${e.pct >= 0 ? '+' : ''}${(e.pct * 100).toFixed(1)}%` : '';
  const crowd = e ? spots.reduce((a, i) => a + (onBoard[i] ?? 0), 0) / spots.length : 0;
  return (
    <View style={styles.evWrap}>
      <Row
        icon="bolt"
        label="Round signal"
        info={`Expected value of this deploy, from ORE's own rules. SOL back: ORE keeps 1% of every spot and 10% more of spots that miss, so about 89.5% of each SOL comes back on average (the Gali fee is ${Number(PLATFORM_FEE_BPS) / 100}%). ORE: each spot strikes 1 time in 25; its 1 ORE, plus the motherlode 1 round in 500, is shared by SOL on that spot, so crowded spots pay less. ORE is valued at today's ORE/SOL price (Jupiter, every 5 minutes) minus ORE's 10% claim fee. +EV means the ORE you can expect is worth more than the SOL you can expect to lose. It is an average over many rounds: any one round is all or nothing on the gold spot, and more SOL can land before the round ends. Not financial advice.`}
        right={
          e ? (
            <PixelBox fill={plus ? '#0f3d27' : '#3d0f15'} edge={plus ? COLORS.green : COLORS.red} u={1.5} style={styles.evPill}>
              <T v="num" style={{ fontSize: 18, lineHeight: 19, color: plus ? COLORS.green : COLORS.red }}>
                {plus ? '+EV' : '-EV'} {pct}
              </T>
            </PixelBox>
          ) : (
            <T v="num" style={{ fontSize: 16, color: COLORS.muted }}>
              {price ? 'NO SPOTS' : 'WAITING FOR PRICE'}
            </T>
          )
        }
      />
      {e ? (
        <T v="num" style={styles.evNote}>
          {ref ? `For ${fmtSol(stake * spots.length, 4)} SOL on ${spots.length} spot${spots.length > 1 ? 's' : ''}: ` : `Your ${fmtSol(e.cost, 4)} SOL: `}
          ≈{fmtSol(e.solBack, 4)} SOL back + ≈{e.ore.toFixed(e.ore < 0.01 ? 5 : 3)} ORE. {plus ? 'Pays' : 'Pays off'} while spots hold under {fmtSol(e.breakEvenT, 3)} SOL each (now {fmtSol(crowd, 3)}). Estimate only: SOL can still land before the round ends.
        </T>
      ) : null}
    </View>
  );
}

/** ORE's motherlode, gold when it is big, flashing the new ORE each time it grows. */
const LITE_PER_ROUND = 0.01;

function DeskLite() {
  const compact = false;
  const { balance, live } = useBalance();
  const startRun = useGame((s) => s.startRun);
  const run = useGame((s) => s.run);
  const autopilot = useGame((s) => s.autopilot);
  const busy = useGame((s) => s.wallet.busy);
  const liteMode = useGame((s) => s.liteMode);
  const [amount, setAmount] = useState('');
  // LITE always covers the whole board. Clicking spots on the map (or shaking) means picking tiles: that is PRO.
  useEffect(() => {
    if (run || liteMode === 'all') return;
    const st = useGame.getState();
    const n = st.selected.length;
    if (n > 0) {
      if (liteMode === 'smart') st.editPreset({ blocks: 'smart', smartN: n });
      else st.editPreset({ blocks: 'manual' });
      useGame.setState({ liteMode: 'all', dockTab: 'pro' });
    } else useGame.setState({ liteMode: 'all' });
  }, [liteMode, run]);

  const amt = Number(amount) || 0;
  const rounds = Math.floor(amt / LITE_PER_ROUND + 1e-9);
  const total = rounds * LITE_PER_ROUND;
  const need = total + (rounds > 1 ? EXEC_FEE * rounds : 0);
  const enough = need <= balance + 1e-9;
  const ready = rounds > 0 && enough && !(live && autopilot) && !busy;
  const max = () => {
    const room = balance - 0.001 - (live ? EXEC_FEE * Math.floor(balance / LITE_PER_ROUND) : 0);
    setAmount(trim(Math.max(0, Math.floor(room / LITE_PER_ROUND + 1e-9)) * LITE_PER_ROUND));
  };
  const label = !amt
    ? 'ENTER AMOUNT'
    : !rounds
      ? `MIN ${LITE_PER_ROUND} SOL`
      : !enough
        ? 'NOT ENOUGH SOL'
        : live && autopilot
          ? 'STOP AUTOPILOT FIRST'
          : `DEPLOY ${fmtSol(total)} SOL`;
  const lock = Boolean(run);
  return (
    <>
      {compact ? null : (
        <>
          <BigAmount value={amount} onChange={setAmount} hint="SOL to mine with" disabled={lock} />
          <QuickAdd onAdd={(v) => setAmount((c) => addTo(c, v))} onMax={max} disabled={lock} />
          <Row
            icon="hourglass"
            label="Rounds"
            info={`LITE splits your SOL into ${LITE_PER_ROUND} SOL rounds on all 25 spots, so you hit the gold spot every round. More than 1 round runs on autopilot: one wallet approval, then rounds deploy by themselves. Stop any time to get the unused SOL back (the Gali fee is paid up front and not refunded).`}
            right={
              <T v="num" style={{ fontSize: 18, color: rounds ? COLORS.text : COLORS.muted }}>
                {rounds}
              </T>
            }
          />
          <EvRow squares={[...Array(BLOCKS).keys()]} perSpot={rounds ? LITE_PER_ROUND / BLOCKS : 0} />
          <Row
            icon="sol"
            label="Per round"
            last
            right={
              <T v="num" style={{ fontSize: 18, color: rounds ? COLORS.sol : COLORS.muted }}>
                {rounds ? LITE_PER_ROUND : 0} SOL
              </T>
            }
          />
          <AutopilotRow />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `All 25 spots · ${rounds > 1 ? `${rounds} rounds on autopilot` : 'this round'}` : undefined}
        onStart={() =>
          void startRun({
            kind: 'lite',
            perRound: LITE_PER_ROUND,
            perSpot: LITE_PER_ROUND / BLOCKS,
            blocks: 'all',
            smartN: BLOCKS,
            manualMask: (1 << BLOCKS) - 1,
            total: rounds,
          })
        }
      />
    </>
  );
}

/* ---------------- GALI AI: an ORE automation the AI plays, with a weekly pass ---------------- */
const AI_INFO =
  "ORE's draw is random, so no bot can see the winning spot. Gali's bot plays from your own ORE automation, with the app closed, in one of two ways. BOT: no AI, it plays exactly your rules every round (how many spots, SOL per spot, which spots to skip, a motherlode trigger). AI BOT: you pick a style and a team of five AI agents tunes it from its own results. Safe plays only spots worth more than they cost, with a margin; Solo hunter chases the solo 1 ORE and accepts losing rounds; Motherlode chaser waits for a big motherlode and plays hard for it. Your limits always hold: most per spot (ORE enforces it), most per round and a stop-loss. Gali's fee is the same 0.25% as LITE and PRO, only on rounds the bot plays. You can still lose: one spot in 25 wins. Not financial advice.";
const AI_PER_SPOT_DEFAULT = '0.01';

const signed = (v: number, dp = 4) => `${v >= 0 ? '+' : '-'}${fmtSol(Math.abs(v), dp)}`;

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** What changed between two reviews' settings, in words a player can follow. */
function changes(e: AiLogEntry, prev: AiLogEntry | undefined): string {
  if (!prev) return `Margin ${pct(e.minEdge)}, expects ${pct(e.crowdBuffer)} more SOL after it deploys, up to ${pct(e.maxRoundShare)} of your balance a round, deploys ${e.targetSlotsLeft} slots before the end.`;
  const out: string[] = [];
  if (e.minEdge !== prev.minEdge) out.push(`margin ${pct(prev.minEdge)} → ${pct(e.minEdge)}`);
  if (e.crowdBuffer !== prev.crowdBuffer) out.push(`late SOL expected ${pct(prev.crowdBuffer)} → ${pct(e.crowdBuffer)}`);
  if (e.maxRoundShare !== prev.maxRoundShare) out.push(`most per round ${pct(prev.maxRoundShare)} → ${pct(e.maxRoundShare)} of balance`);
  if (e.targetSlotsLeft !== prev.targetSlotsLeft) out.push(`deploys ${prev.targetSlotsLeft} → ${e.targetSlotsLeft} slots before the end`);
  return out.length ? `Changed: ${out.join(', ')}.` : '';
}
const when = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (m < 60) return `${m}m ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)}h ago`;
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

const VOTES: { id: AiVote; label: string }[] = [
  { id: 'more', label: 'Play more' },
  { id: 'same', label: 'Keep it' },
  { id: 'safer', label: 'Play safer' },
];
const waitText = (ms: number) => {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Subscribers only: tell the reviews how it is doing. Once every 2 hours. */
function AiFeedback({ nextAt }: { nextAt: number | null }) {
  const [vote, setVote] = useState<AiVote | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const wait = nextAt && nextAt > now ? nextAt - now : 0;
  return (
    <View style={{ gap: 6 }}>
      {wait ? (
        <T v="num" style={styles.evNote}>
          Thanks for your feedback. You can send more in {waitText(wait)}. The team reads it at every review.
        </T>
      ) : (
        <>
          <T v="num" style={styles.evNote}>
            How is the AI bot doing for you? The reviews read every subscriber's vote. Once every 2 hours.
          </T>
          <View style={[styles.lineRight, { marginTop: 2 }]}>
            {VOTES.map((v) => (
              <Chip key={v.id} grow label={v.label} on={vote === v.id} onPress={() => setVote(v.id)} disabled={sending} />
            ))}
          </View>
          <PixelBox fill="#050817" hi="#02040c" lo="#22356f" edge="#04060f" style={styles.aiComment}>
            <TextInput
              value={comment}
              onChangeText={(t) => setComment(t.slice(0, 200))}
              placeholder="Anything else? (optional)"
              placeholderTextColor={COLORS.muted}
              style={styles.aiCommentInput}
              accessibilityLabel="Comment for the AI bot's review, optional"
              maxLength={200}
              multiline
            />
          </PixelBox>
          <Btn
            kind={vote ? 'gold' : 'plain'}
            label={sending ? 'SENDING…' : vote ? 'SEND FEEDBACK' : 'PICK ONE FIRST'}
            onPress={() => {
              if (!vote) return;
              setSending(true);
              void sendFeedback(vote, comment.trim()).then((ok) => {
                setSending(false);
                if (ok) {
                  setVote(null);
                  setComment('');
                }
              });
            }}
            disabled={!vote || sending}
          />
        </>
      )}
    </View>
  );
}

/** Subscribers only: what the AI bot learned at each review, newest first. */
function AiLog({ log, busy }: { log: AiLogEntry[] | null; busy: boolean }) {
  const [all, setAll] = useState(false);
  return (
    <View>
      {log === null ? (
        <Btn kind="plain" label={busy ? 'LOADING…' : 'READ THE LEARNING LOG'} sub="Sign in once with your wallet. No fee" onPress={() => void loadLog(true)} disabled={busy} />
      ) : !log.length ? (
        <T v="num" style={styles.evNote}>
          Nothing yet. The round reviewer writes what it learned every 15 minutes, and the team reviews the settings every 3 hours and once a day.
        </T>
      ) : (
        <>
          {(all ? log : log.slice(0, 6)).map((e, i, shown) => (
            <View key={`${e.kind}${e.at}`} style={[styles.aiLog, i === shown.length - 1 && { borderBottomWidth: 0 }]}>
              <T v="num" style={{ fontSize: 13, color: COLORS.muted }}>
                {when(e.at)}
                {e.kind === 'rounds' ? ` · Round review · ${e.rounds} rounds, ${e.played} played` : e.kind === 'daily' ? ' · Daily review' : ' · Settings review'}
                {e.plays !== null ? ` · ${e.plays} plays in the 24h before` : ''}
              </T>
              {e.learned ? (
                <T v="num" style={{ fontSize: 15, color: COLORS.text, lineHeight: 18 }}>
                  {e.learned}
                </T>
              ) : null}
              {e.kind === 'rounds' ? (
                e.watch ? (
                  <T v="num" style={{ fontSize: 13, color: COLORS.teal, lineHeight: 16 }}>
                    Watching: {e.watch}
                  </T>
                ) : null
              ) : (
                <T v="num" style={{ fontSize: 13, color: COLORS.teal, lineHeight: 16 }}>
                  {[e.note, changes(e, log.slice(log.indexOf(e) + 1).find((x) => x.kind !== 'rounds')) || (e.note ? '' : 'No changes.')].filter(Boolean).join(' ')}
                </T>
              )}
              {e.feedbackReply ? (
                <T v="num" style={{ fontSize: 13, color: COLORS.gold, lineHeight: 16 }}>
                  Your feedback: {e.feedbackReply}
                </T>
              ) : null}
            </View>
          ))}
          {log.length > 6 ? <Chip label={all ? 'SHOW LESS' : `SHOW ALL ${log.length}`} onPress={() => setAll(!all)} /> : null}
        </>
      )}
    </View>
  );
}

/** Quick starting points for the Bot's rules; every value stays editable. */
const BOT_PRESETS: Record<'aggressive' | 'balance' | 'safe', Partial<BotSettings>> = {
  aggressive: { spots: 24, perSpotSol: 0.005, maxSpotSol: null, minMotherlodeOre: null, maxRoundSol: 0.12, stopLossSol: 0.5 },
  balance: { spots: 23, perSpotSol: 0.002, maxSpotSol: null, minMotherlodeOre: null, maxRoundSol: 0.05, stopLossSol: 0.2 },
  safe: { spots: 23, perSpotSol: 0.0005, maxSpotSol: 0.5, minMotherlodeOre: null, maxRoundSol: 0.012, stopLossSol: 0.05 },
};
const AI_STYLES: { id: AiStyle; label: string; about: string }[] = [
  { id: 'solo', label: 'AGGRESSIVE', about: '23-25 spots, big bets, chases solo 1 ORE and motherlode.' },
  { id: 'balance', label: 'BALANCE', about: '23-25 spots, smaller bets, steady ORE.' },
  { id: 'safe', label: 'PLAY SAFE', about: 'Only plays rounds worth more than they cost.' },
];
const numText = (n: number | null) => (n === null ? '' : String(n));
const numOrNull = (t: string) => (t.trim() === '' || !(Number(t) > 0) ? null : Number(t));

/** One small number box with its label: empty means "no such rule". */
function NumField({ label, info, value, onChange, unit, last }: { label: string; info: string; value: string; onChange: (v: string) => void; unit: string; last?: boolean }) {
  return (
    <Row
      icon="sol"
      label={label}
      info={info}
      right={
        <PixelBox fill="#050817" hi="#02040c" lo="#22356f" edge="#04060f" style={styles.aiSpot}>
          <TextInput
            value={value}
            onChangeText={(t) => onChange(cleanAmt(t))}
            keyboardType="decimal-pad"
            placeholder="off"
            placeholderTextColor={COLORS.line}
            style={styles.aiSpotInput}
            accessibilityLabel={label}
            numberOfLines={1}
          />
          <T v="display" style={{ fontSize: 14, color: COLORS.muted }}>
            {unit}
          </T>
        </PixelBox>
      }
      last={last}
    />
  );
}

/** Subscribers: Bot (their own rules, no AI) or AI bot (a style the agents tune), and their own limits. */
/** Bot or AI bot, pinned just under LITE / PRO / BOT. Picks which settings show below; SAVE SETTINGS applies it. */
function BotModeSwitch() {
  const saved = useAi((s) => s.settings?.mode ?? DEFAULT_BOT_SETTINGS.mode);
  const draft = useAi((s) => s.modeDraft);
  const running = useGame((s) => Boolean(s.autopilot?.ai));
  const owner = useGame((s) => s.wallet.owner);
  if (!botAllowed(owner) && !running) return null;
  // while it runs the switch shows what is playing and cannot change
  const mode = running ? saved : (draft ?? saved);
  const pick = (m: BotMode) => useAi.setState({ modeDraft: m });
  return (
    <View style={[styles.lineRight, { marginBottom: 10 }]}>
      <Chip grow label="BOT · YOUR RULES" on={mode === 'bot'} onPress={() => pick('bot')} disabled={running} />
      <Chip grow label="AI BOT" on={mode === 'ai'} onPress={() => pick('ai')} disabled={running} />
    </View>
  );
}

/** Before START: Bot (their own rules, no AI) or AI bot (a style the agents tune), and their own limits. START saves them. */
function BotSettingsPanel({ saved }: { saved: BotSettings | null }) {
  const start = saved ?? DEFAULT_BOT_SETTINGS;
  const mode = useAi((s) => s.modeDraft) ?? start.mode;
  const [style, setStyle] = useState<AiStyle>(start.style);
  const [f, setF] = useState(() => ({
    spots: String(start.spots), perSpot: String(start.perSpotSol), maxSpot: numText(start.maxSpotSol), minMotherlode: numText(start.minMotherlodeOre),
    maxRound: numText(start.maxRoundSol), stopLoss: numText(start.stopLossSol),
  }));
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const preset = (p: Partial<BotSettings>) =>
    setF({ spots: String(p.spots), perSpot: String(p.perSpotSol), maxSpot: numText(p.maxSpotSol ?? null), minMotherlode: numText(p.minMotherlodeOre ?? null), maxRound: numText(p.maxRoundSol ?? null), stopLoss: numText(p.stopLossSol ?? null) });
  const spots = Math.round(Number(f.spots));
  const ok = mode === 'ai' || (spots >= 1 && spots <= 25 && Number(f.perSpot) > 0);
  // the START button reads what is filled in here
  useEffect(() => {
    useAi.setState({
      draft: ok
        ? {
            mode, style, spots: spots >= 1 && spots <= 25 ? spots : 10, perSpotSol: Number(f.perSpot) > 0 ? Number(f.perSpot) : 0.002,
            maxSpotSol: numOrNull(f.maxSpot), minMotherlodeOre: numOrNull(f.minMotherlode), maxRoundSol: numOrNull(f.maxRound), stopLossSol: numOrNull(f.stopLoss),
          }
        : null,
    });
  }, [ok, mode, style, spots, f]);
  const [edit, setEdit] = useState(false);
  const rulesLine = [
    mode === 'bot' ? `${f.spots || '?'} spots × ${f.perSpot || '?'} SOL` : null,
    mode === 'bot' && f.maxSpot ? `skip > ${f.maxSpot}` : null,
    mode === 'bot' && f.minMotherlode ? `motherlode ≥ ${f.minMotherlode}` : null,
    f.maxRound ? `max ${f.maxRound}/round` : null,
    f.stopLoss ? `stop-loss ${f.stopLoss}` : null,
  ].filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.lineRight}>
        {mode === 'bot'
          ? (['aggressive', 'balance', 'safe'] as const).map((k) => (
              <Chip key={k} grow label={k === 'safe' ? 'PLAY SAFE' : k.toUpperCase()} onPress={() => preset(BOT_PRESETS[k])} />
            ))
          : AI_STYLES.map((x) => <Chip key={x.id} grow label={x.label} on={style === x.id} onPress={() => setStyle(x.id)} />)}
      </View>
      <Pressable onPress={() => setEdit(true)} style={styles.rulesLine} accessibilityRole="button" accessibilityLabel="Edit rules and limits">
        <T v="num" numberOfLines={1} style={{ flex: 1, fontSize: 13, color: ok ? COLORS.text : COLORS.red }}>
          {mode === 'bot' ? (ok ? rulesLine.join(' · ') : 'Set your spots and SOL per spot') : [AI_STYLES.find((x) => x.id === style)?.about, ...rulesLine].filter(Boolean).join(' · ')}
        </T>
        <T v="label" style={{ fontSize: 12, color: COLORS.gold }}>
          EDIT
        </T>
      </Pressable>
      <PopCard title={mode === 'bot' ? 'YOUR BOT RULES' : 'AI BOT LIMITS'} open={edit} onClose={() => setEdit(false)}>
        {mode === 'bot' ? (
          <>
            <NumField label="Spots" info="How many spots to play each round, quietest first (1 to 25)." value={f.spots} onChange={set('spots')} unit="of 25" />
            <NumField label="SOL per spot" info="How much SOL on each spot. Never more than your most per spot, which ORE enforces." value={f.perSpot} onChange={set('perSpot')} unit="SOL" />
            <NumField label="Skip spots over" info="Never join a spot already holding more than this. Empty: no limit." value={f.maxSpot} onChange={set('maxSpot')} unit="SOL" />
            <NumField label="Only when motherlode ≥" info="Play only when the motherlode holds at least this much ORE. Empty: every round." value={f.minMotherlode} onChange={set('minMotherlode')} unit="ORE" />
          </>
        ) : null}
        <NumField label="Most per round" info="The most SOL the bot may use in one round. Empty: no extra limit beyond your balance and most per spot." value={f.maxRound} onChange={set('maxRound')} unit="SOL" />
        <NumField
          label="Stop-loss"
          info="Stop once the bot is this much SOL down since it started (ORE mined counts at today's price). Empty: no stop-loss."
          value={f.stopLoss}
          onChange={set('stopLoss')}
          unit="SOL"
          last
        />
        <T v="num" style={[styles.evNote, { marginTop: 6 }]}>
          Empty means no limit. Settings lock while the bot runs.
        </T>
      </PopCard>
    </View>
  );
}

/** While the bot runs: what it plays, read-only. Settings change only after STOP. */
function BotSettingsSummary({ s }: { s: BotSettings | null }) {
  const v = s ?? DEFAULT_BOT_SETTINGS;
  const parts =
    v.mode === 'bot'
      ? [`quietest ${v.spots} spots`, `${v.perSpotSol} SOL each`, v.maxSpotSol ? `skips spots over ${v.maxSpotSol} SOL` : null, v.minMotherlodeOre ? `only when the motherlode is ${v.minMotherlodeOre}+ ORE` : null]
      : [AI_STYLES.find((x) => x.id === v.style)?.about ?? ''];
  const limits = [v.maxRoundSol ? `most ${v.maxRoundSol} SOL a round` : null, v.stopLossSol ? `stop-loss ${v.stopLossSol} SOL` : null].filter(Boolean);
  return (
    <View style={[styles.aiLog, { borderBottomWidth: 0 }]}>
      <T v="label" style={{ color: COLORS.gold }}>
        {v.mode === 'bot' ? 'BOT · YOUR RULES' : `AI BOT · ${AI_STYLES.find((x) => x.id === v.style)?.label ?? 'PLAY SAFE'}`}
      </T>
      <T v="num" style={{ fontSize: 14, color: COLORS.text, lineHeight: 17 }}>
        {[...parts.filter(Boolean), ...limits].join(' · ')}
      </T>
      <T v="num" style={styles.evNote}>
        Locked while your bot runs. STOP it to change these settings.
      </T>
    </View>
  );
}

function AiPanel() {
  const { balance, live } = useBalance();
  const autopilot = useGame((s) => s.autopilot);
  const busy = useGame((s) => s.wallet.busy);
  const owner = useGame((s) => s.wallet.owner);
  const startAi = useGame((s) => s.startAiMining);
  const stopAutopilot = useGame((s) => s.stopAutopilot);
  const { status, stats, me, claiming, log, logBusy, settings, day } = useAi();
  const [pop, setPop] = useState<null | 'learned' | 'feedback' | 'rounds'>(null);
  const [amount, setAmount] = useState('');
  const [perSpot, setPerSpot] = useState(AI_PER_SPOT_DEFAULT);
  useEffect(() => {
    void refreshAi();
    const id = setInterval(() => void refreshAi(), 60_000);
    return () => clearInterval(id);
  }, [owner]);

  const oreSol = stats?.oreSol ?? 0;
  const dayNet = day ? netSol(day, oreSol) : 0;
  const passOn = Boolean(me?.expiresAt && me.expiresAt > Date.now());
  useEffect(() => {
    if (!passOn) return;
    void loadLog(false);
    const id = setInterval(() => void loadLog(false), 10 * 60_000);
    return () => clearInterval(id);
  }, [passOn, owner]);
  const aiOn = Boolean(autopilot?.ai);
  const amt = Number(amount) || 0;
  const spot = Number(perSpot) || 0;
  const draft = useAi((s) => s.draft);
  const ready = live && passOn && !autopilot && Boolean(draft) && amt > 0 && spot >= 0.0001 && spot <= amt && amt <= balance + 1e-9 && !busy;
  const label = !live
    ? 'MAINNET WALLET NEEDED'
    : autopilot && !aiOn
      ? 'STOP AUTOPILOT FIRST'
      : !draft
        ? 'CHECK YOUR BOT SETTINGS'
        : !amt
          ? 'ENTER AMOUNT'
          : amt > balance + 1e-9
            ? 'NOT ENOUGH SOL'
            : !(spot >= 0.0001)
              ? 'MIN 0.0001 SOL A SPOT'
              : spot > amt
                ? 'LIMIT IS OVER THE AMOUNT'
                : `START BOT · ${fmtSol(amt)} SOL`;

  // closed while it is being tuned; a bot already running can still be seen and stopped
  if (!botAllowed(owner) && !aiOn) {
    return (
      <View style={[styles.aiLog, styles.botPanel, { borderBottomWidth: 0 }]}>
        <T v="label" style={{ color: COLORS.gold }}>
          BOT MINING IS CLOSED FOR NOW
        </T>
        <T v="num" style={styles.evNote}>
          We are tuning the bots before opening them to everyone. LITE and PRO work as usual.
        </T>
      </View>
    );
  }

  return (
    <View style={styles.botPanel}>
      {/* one line: today's result, the pass, the agents */}
      <View style={styles.botStrip}>
        <StatCell
          label="TODAY"
          value={day && day.rounds ? `${signed(dayNet)} SOL` : '—'}
          sub={day && day.rounds ? `${day.ore.toFixed(4)} ORE · ${day.rounds} rds` : 'no rounds yet'}
          color={!day || !day.rounds ? COLORS.muted : dayNet >= 0 ? COLORS.green : COLORS.red}
          info={`Your bot's drawn rounds in the last 24 hours${day ? `: ${day.rounds} rounds, ${day.wins} on the winning spot` : ''}. SOL back plus ORE mined (at today's ORE/SOL price after ORE's 10% claim fee), minus the SOL played and Gali's 0.25% fee.`}
        />
        <StatCell
          label="PASS"
          value={passOn ? new Date(me!.expiresAt!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : claiming ? '…' : 'none'}
          sub={passOn ? 'active' : 'needed'}
          color={passOn ? COLORS.teal : COLORS.muted}
          info="0.1 SOL gives you 7 days of Bot and AI bot, paid to Gali's revenue wallet. Buying again adds 7 more days. The SOL you mine with stays yours, inside ORE."
        />
        <StatCell
          label="AI AGENTS"
          value="5"
          sub="learning"
          color={COLORS.gold}
          info="Five AI agents study every round of the whole ORE board, every miner, even when nobody uses the bot. A round reviewer writes what it learned every 15 minutes; an analyst, a feedback reader, a risk checker and a lead tune each style every 3 hours and once a day."
        />
      </View>
      {passOn || aiOn ? (
        <View style={styles.lineRight}>
          <Chip grow label="ROUNDS" onPress={() => setPop('rounds')} />
          {passOn ? <Chip grow label="AI LEARNED" onPress={() => { setPop('learned'); if (log === null) void loadLog(true); }} /> : null}
          {passOn ? <Chip grow label="FEEDBACK" onPress={() => setPop('feedback')} /> : null}
        </View>
      ) : null}

      {aiOn ? (
        <>
          <AutopilotRow />
          <BotSettingsSummary s={settings} />
          {!passOn ? (
            <T v="num" style={styles.evNote}>
              Pass ended: your bot is paused. Renew it, or STOP to take your SOL back.
            </T>
          ) : null}
        </>
      ) : passOn ? (
        <>
          <BotSettingsPanel key={JSON.stringify(settings)} saved={settings} />
          <BigAmount value={amount} onChange={setAmount} hint="SOL for your bot" disabled={Boolean(busy)} />
          <QuickAdd onAdd={(v) => setAmount((c) => addTo(c, v))} onMax={() => setAmount(trim(balance - 0.001))} disabled={Boolean(busy)} />
          <Row
            icon="sol"
            label="Most per spot"
            info="The most your bot may put on one spot in a round. ORE enforces it: the bot can never go over, whatever its rules or style."
            right={
              <PixelBox fill="#050817" hi="#02040c" lo="#22356f" edge="#04060f" style={styles.aiSpot}>
                <TextInput
                  value={perSpot}
                  onChangeText={(t) => setPerSpot(cleanAmt(t))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={COLORS.line}
                  style={styles.aiSpotInput}
                  accessibilityLabel="Most SOL per spot"
                  numberOfLines={1}
                />
                <T v="display" style={{ fontSize: 14, color: COLORS.muted }}>
                  SOL
                </T>
              </PixelBox>
            }
            last
          />
          {autopilot && !aiOn ? <AutopilotRow /> : null}
          <Btn
            kind={ready ? 'gold' : 'plain'}
            label={busy ?? label}
            sub={ready ? '0.25% fee only on rounds it plays' : undefined}
            onPress={() => {
              // settings first: saved before the bot is funded, locked while it runs
              const d = useAi.getState().draft;
              if (!d) return;
              void saveBotSettings(d).then((saved) => {
                if (!saved) return;
                useAi.setState({ modeDraft: null });
                void startAi(amt, spot).then((ok) => ok && setAmount(''));
              });
            }}
            disabled={!ready}
            style={{ minHeight: 50 }}
          />
        </>
      ) : null}
      {!aiOn && owner && me?.trialOpen ? (
        <Btn
          kind="gold"
          label={busy ?? 'TRY THE BOT FREE · 7 DAYS'}
          sub="First time only. No fee"
          onPress={() => void startTrial()}
          disabled={Boolean(busy) || !live}
        />
      ) : null}
      {!aiOn && owner ? (
        <Btn
          kind={passOn || me?.trialOpen ? 'plain' : 'gold'}
          label={busy ?? (passOn ? 'ADD 7 DAYS · 0.1 SOL' : 'GET THE BOT PASS · 0.1 SOL / 7 DAYS')}
          onPress={() => void buyPass()}
          disabled={Boolean(busy) || claiming || !live}
        />
      ) : null}

      <T v="num" style={[styles.evNote, { marginTop: 0, fontSize: 12 }]}>
        Random draw: no bot sees the winning spot. You can lose. Not financial advice.
      </T>

      <PopCard title="YOUR BOT'S ROUNDS" open={pop === 'rounds'} onClose={() => setPop(null)}>
        <RoundList />
      </PopCard>
      <PopCard title="WHAT THE AI LEARNED" open={pop === 'learned'} onClose={() => setPop(null)}>
        <AiLog log={log} busy={logBusy} />
      </PopCard>
      <PopCard title="HELP IT LEARN" open={pop === 'feedback'} onClose={() => setPop(null)}>
        <AiFeedback nextAt={me?.nextFeedbackAt ?? null} />
      </PopCard>
    </View>
  );
}

/** Polls `load` every `ms` while shown. */
function usePoll<T>(load: () => Promise<T | null>, ms: number): T | null | 'loading' {
  const [v, setV] = useState<T | null | 'loading'>('loading');
  useEffect(() => {
    let on = true;
    const go = () => void load().then((x) => on && setV((old) => (x === null && old !== 'loading' && old !== null ? old : x)));
    go();
    const id = setInterval(go, ms);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  return v;
}
const shortWallet = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

/** Everyone who deployed in the round being played now, biggest first; refreshes every 5 seconds. */
export function RoundNowList({ owner }: { owner: string | null }) {
  const r = usePoll<RoundNow>(() => loadRoundNow(), 5_000);
  if (r === 'loading') return <T v="num" style={styles.evNote}>Loading…</T>;
  if (!r) return <T v="num" style={styles.evNote}>Could not read the round. Try again in a moment.</T>;
  const secs = Math.round(r.slotsLeft * 0.22);
  return (
    <View>
      <T v="num" style={[styles.evNote, { marginBottom: 6 }]}>
        Round #{r.round} · {r.miners} miners · {r.sol.toFixed(3)} SOL{r.slotsLeft > 0 ? ` · about ${secs}s left` : ' · drawing'}
      </T>
      {!r.list.length ? (
        <T v="num" style={styles.evNote}>
          Nobody has deployed yet.
        </T>
      ) : (
        r.list.map((m, i) => (
          <View key={m.wallet} style={[styles.roundNowRow, i === r.list.length - 1 && { borderBottomWidth: 0 }]}>
            <T v="num" style={{ width: 26, fontSize: 12, color: COLORS.muted }}>
              {i + 1}
            </T>
            <T v="num" numberOfLines={1} style={{ flex: 1, fontSize: 13, color: m.wallet === owner ? COLORS.gold : COLORS.text }}>
              {m.wallet === owner ? 'YOU' : m.name || shortWallet(m.wallet)}
            </T>
            <T v="num" style={{ fontSize: 12, color: COLORS.muted }}>
              {m.spots} spots · {m.perSpot.toFixed(4)}
            </T>
            <T v="num" style={{ width: 70, textAlign: 'right', fontSize: 13, color: COLORS.sol }}>
              {m.sol.toFixed(4)}
            </T>
          </View>
        ))
      )}
    </View>
  );
}

/** Every round since the bot started, newest first: what it played and how it went, or why it sat out. */
function RoundList() {
  const [rows, setRows] = useState<AiRoundRow[] | null | 'loading'>('loading');
  useEffect(() => {
    let on = true;
    const load = () => void loadRounds().then((r) => on && setRows(r));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, []);
  if (rows === 'loading') return <T v="num" style={styles.evNote}>Loading…</T>;
  if (!rows) return <T v="num" style={styles.evNote}>Could not load your rounds. Try again in a moment.</T>;
  if (!rows.length) return <T v="num" style={styles.evNote}>No rounds yet. Rounds show here once your bot starts.</T>;
  const played = rows.filter((r) => r.landed);
  const onWin = played.filter((r) => r.won).length;
  return (
    <View>
      <T v="num" style={[styles.evNote, { marginBottom: 6 }]}>
        {rows.length} rounds · played {played.length} · on the winning spot {onWin} · sat out {rows.filter((r) => !r.played).length} · missed {rows.filter((r) => r.played && !r.landed && r.settled).length}
      </T>
      {rows.map((r, i) => {
        const head = `#${r.round} · ${new Date(r.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        let line: string;
        let color: string = COLORS.muted;
        if (!r.played) {
          line =
            r.quietestSol !== null && r.joinLimitSol !== null
              ? `Sat out: quietest spot ${r.quietestSol.toFixed(3)} SOL, over its ${r.joinLimitSol.toFixed(3)} SOL limit`
              : r.botsPlayed !== null
                ? 'Sat out: your rules or limits said no'
                : 'Sat out: the bot was between runs';
        } else if (!r.landed && r.settled) {
          line = `Bet did not land (${r.squares} spots, ${r.sol.toFixed(4)} SOL): round missed, no SOL spent`;
          color = COLORS.red;
        } else if (!r.settled) {
          line = `${r.squares} spots · ${r.sol.toFixed(4)} SOL · drawing…`;
          color = COLORS.text;
        } else {
          const net = (r.back ?? 0) - r.sol;
          line = `${r.squares} spots · ${r.sol.toFixed(4)} SOL · ${r.won ? 'ON the winning spot' : 'missed the winning spot'} · back ${(r.back ?? 0).toFixed(4)} (${net >= 0 ? '+' : ''}${net.toFixed(4)})${r.ore ? ` · +${r.ore.toFixed(4)} ORE` : ''}`;
          color = r.ore ? COLORS.green : r.won ? COLORS.text : COLORS.red;
        }
        return (
          <View key={r.round} style={[styles.aiLog, { paddingVertical: 5 }, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
            <T v="num" style={{ fontSize: 12, color: COLORS.muted }}>
              {head}
            </T>
            <T v="num" style={{ fontSize: 13, color, lineHeight: 16 }}>
              {line}
            </T>
          </View>
        );
      })}
    </View>
  );
}

/** One small stat in the BOT tab's top line; tap the label for what it means. */
function StatCell({ label, value, sub, color, info }: { label: string; value: string; sub: string; color: string; info: string }) {
  const toast = useGame((s) => s.toast);
  return (
    <Pressable onPress={() => toast(info, 'info')} style={styles.botCell} accessibilityRole="button" accessibilityLabel={`${label}: ${value}, ${sub}. More info`}>
      <T v="label" style={{ fontSize: 11, color: COLORS.muted }} numberOfLines={1}>
        {label}
      </T>
      <T v="num" style={{ fontSize: 15, color }} numberOfLines={1}>
        {value}
      </T>
      <T v="num" style={{ fontSize: 11, color: COLORS.muted }} numberOfLines={1}>
        {sub}
      </T>
    </Pressable>
  );
}

/** A card that pops up over the game, for what does not fit the BOT tab. It scrolls inside if long. */
function PopCard({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions();
  if (!open) return null;
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Scrim onPress={onClose}>
        <ModalCenter>
          <Window title={title} accent={COLORS.gold} onClose={onClose} width={440}>
            <ScrollView style={{ maxHeight: Math.max(240, height * 0.65) }} showsVerticalScrollIndicator>
              {children}
            </ScrollView>
            <Btn kind="plain" label="CLOSE" onPress={onClose} style={{ marginTop: 10 }} />
          </Window>
        </ModalCenter>
      </Scrim>
    </Modal>
  );
}

/* ---------------- RIGHT BAR PRO, like ORE: SOL a round, how many tiles, how many rounds ---------------- */
function DeskPro() {
  const compact = false;
  const { balance, live } = useBalance();
  const presets = useGame((s) => s.save.presets);
  const idx = useGame((s) => s.save.preset);
  const selected = useGame((s) => s.selected);
  const pending = useGame((s) => s.pending);
  const run = useGame((s) => s.run);
  const autopilot = useGame((s) => s.autopilot);
  const busy = useGame((s) => s.wallet.busy);
  const { editPreset, startRun, selectAll, clearSelection } = useGame.getState();
  const p: Preset = presets[idx] ?? presets[0];

  const tiles = p.blocks === 'all' ? BLOCKS : p.blocks === 'smart' ? p.smartN : selected.length;
  // older saves kept SOL per spot: show it as SOL a round
  const perRoundStr = p.perRound ?? (p.perSpot ? trim((Number(p.perSpot) || 0) * Math.max(1, tiles)) : '');
  const per = Number(perRoundStr) || 0;
  const perSpot = tiles ? Math.floor((per / tiles) * 1e9) / 1e9 : 0;
  const rounds = p.rounds;
  const lock = Boolean(run);
  // ALL and random tiles show on the map as soon as PRO opens
  useEffect(() => {
    if (run || pending) return;
    if (p.blocks === 'all' && selected.length !== BLOCKS) selectAll();
    else if (p.blocks === 'smart' && selected.length !== p.smartN) useGame.setState({ selected: randomPick(p.smartN) });
  }, [p.blocks, p.smartN, selected.length, run, pending, selectAll]);

  const setPer = (v: string) => editPreset({ perRound: v });
  const setTiles = (n: number) => {
    const t = Math.max(0, Math.min(BLOCKS, n));
    if (t === BLOCKS) {
      editPreset({ blocks: 'all', smartN: BLOCKS });
      selectAll();
    } else if (t === 0) {
      editPreset({ blocks: 'manual' });
      clearSelection();
    } else {
      // n tiles at random; tap spots on the map to choose them yourself
      editPreset({ blocks: 'smart', smartN: t });
      useGame.setState({ selected: randomPick(t) });
    }
  };
  const max = () => {
    const room = (balance - 0.001 - (live && rounds > 1 ? EXEC_FEE * rounds : 0)) / Math.max(1, rounds);
    setPer(trim(Math.max(0, room)));
  };

  const need = per * rounds + (live && rounds > 1 ? EXEC_FEE * rounds : 0);
  const enough = need <= balance + 1e-9;
  const ready = tiles > 0 && per > 0 && perSpot >= MIN_SOL_PER_BLOCK && enough && !pending && !(live && autopilot) && !busy;
  const label = !per
    ? 'ENTER AMOUNT'
    : !tiles
      ? 'PICK TILES'
      : perSpot < MIN_SOL_PER_BLOCK
        ? `MIN ${trim(MIN_SOL_PER_BLOCK * tiles)} SOL A ROUND`
        : !enough
          ? 'NOT ENOUGH SOL'
          : live && autopilot
            ? 'STOP AUTOPILOT FIRST'
            : pending
              ? 'WAIT FOR THIS ROUND'
                  : `DEPLOY ${fmtSol(per * rounds)} SOL`;
  const solo = useGame((s) => soloOf(s, s.roundId));
  const picked = p.blocks === 'all' ? [...Array(BLOCKS).keys()] : selected;
  const soloCount = picked.filter((i) => solo & (1 << i)).length;

  return (
    <>
      {compact ? null : (
        <>
          <BigAmount value={perRoundStr} onChange={setPer} hint="SOL a round" disabled={lock} />
          <QuickAdd onAdd={(v) => setPer(addTo(perRoundStr, v))} onMax={max} disabled={lock} />
          <Row
            icon="grid"
            label="Tiles"
            info={`${LIVE_INFO} The SOL a round is split evenly over your tiles. − and + pick tiles at random (new ones every round); tap spots on the map to choose them yourself.`}
            right={
              <>
                <Chip label="ALL" on={p.blocks === 'all'} onPress={() => setTiles(BLOCKS)} disabled={lock} />
                <Stepper value={tiles} label="tiles" onMinus={() => setTiles(tiles - 1)} onPlus={() => setTiles(tiles + 1)} disabled={lock} />
              </>
            }
          />
          <Row
            icon="hourglass"
            label="Rounds"
            info={live ? `1 = this round only (you approve in your wallet). More = autopilot: one wallet approval funds ORE's automation for every round, then rounds deploy with no pop-up. Stop it any time to get the unused SOL back (the Gali fee is paid up front and not refunded).` : '1 = this round only. More = autopilot repeats the same setup each round.'}
            right={<Stepper value={rounds} label="rounds" onMinus={() => editPreset({ rounds: Math.max(1, rounds - 1) })} onPlus={() => editPreset({ rounds: Math.min(100, rounds + 1) })} disabled={lock} />}
          />
          <EvRow squares={picked} perSpot={tiles && per ? perSpot : 0} />
          <Row
            icon="sol"
            label="Per round"
            last
            right={
              <T v="num" style={{ fontSize: 18, color: per ? COLORS.sol : COLORS.muted }}>
                {per ? fmtSol(per) : 0} SOL
              </T>
            }
          />
          <AutopilotRow />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={
          ready
            ? `${fmtSol(perSpot, 5)} SOL × ${tiles} tile${tiles > 1 ? 's' : ''} · ${Math.round((tiles / BLOCKS) * 100)}% odds${soloCount ? ` · ${soloCount} ★` : ''}${rounds > 1 ? ` · ${rounds} rounds` : ''}`
            : undefined
        }
        onStart={() =>
          void startRun({
            kind: 'pro',
            perRound: per,
            perSpot,
            blocks: p.blocks,
            smartN: p.smartN,
            manualMask: maskOf(selected),
            total: rounds,
          })
        }
      />
    </>
  );
}


/* ---------------- phone / APK panels (unchanged) ---------------- */
function BalanceRow({ onHalf, onAll }: { onHalf?: () => void; onAll?: () => void }) {
  const { balance, onChain, live } = useBalance();
  const refill = useGame((s) => s.refillPractice);
  const airdrop = useGame((s) => s.airdrop);
  return (
    <View style={[styles.lineRight, { justifyContent: 'space-between', marginTop: 10 }]}>
      <View style={styles.lineLeft}>
        <PixIcon name="wallet" size={18} />
        <T v="display" style={{ fontSize: 18 }}>
          {balance.toFixed(4)}
        </T>
        <T v="muted">{live ? 'SOL · mainnet' : onChain ? 'SOL' : 'practice SOL'}</T>
        {!onChain ? <Chip label="Refill" onPress={refill} /> : CLUSTER === 'devnet' ? <Chip label="+1 devnet" onPress={airdrop} /> : null}
      </View>
      {onHalf && onAll ? (
        <View style={styles.lineRight}>
          <Chip label="Half" onPress={onHalf} />
          <Chip label="All" onPress={onAll} />
        </View>
      ) : null}
    </View>
  );
}

function AmountBox({ value, onChange, hint, suffix }: { value: string; onChange: (v: string) => void; hint: string; suffix?: string }) {
  return (
    <PixelBox fill="#050817" hi="#02040c" lo="#22356f" edge="#04060f" style={styles.amount}>
      <View style={styles.token}>
        <PixIcon name="sol" size={22} />
        <T v="display" style={{ fontSize: 20 }}>
          SOL
        </T>
      </View>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(',', '.').replace(/[^0-9.]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={COLORS.line}
          style={styles.input}
          accessibilityLabel={hint}
          numberOfLines={1}
        />
      </View>
      {suffix ? (
        <T v="display" style={{ marginLeft: 8, fontSize: 15, color: COLORS.muted }}>
          {suffix}
        </T>
      ) : null}
    </PixelBox>
  );
}

const RESERVE = 0.01; // leave room for fees and rent

/** 4 / 8 / 15 / 20: tapping a count, even the one already on, rolls a fresh random set. */
function SmartCounts({ value, onPick, disabled }: { value: number; onPick: (n: number) => void; disabled: boolean }) {
  return (
    <View style={[styles.lineRight, { marginTop: 6 }]}>
      {SMART_COUNTS.map((c) => (
        <Chip key={c} grow label={`${c}`} on={value === c} onPress={() => onPick(c)} disabled={disabled} />
      ))}
    </View>
  );
}

/* LITE: one round; All 25, Smart (random) or spots tapped on the map */
function LitePanel({ compact }: { compact: boolean }) {
  const { balance, live } = useBalance();
  const startRun = useGame((s) => s.startRun);
  const mode = useGame((s) => s.liteMode);
  const smartN = useGame((s) => s.liteSmart);
  const selected = useGame((s) => s.selected);
  const { setLiteSmart, setLiteMode } = useGame.getState();
  const run = useGame((s) => s.run);
  const [perSpot, setPerSpot] = useState('0.0004');
  const spot = Number(perSpot) || 0;
  const n = mode === 'all' ? BLOCKS : selected.length;
  const per = spot * n; // SOL this round
  const perBlockOk = spot >= MIN_SOL_PER_BLOCK;
  const enough = per <= balance + 1e-9;
  const ready = n > 0 && per > 0 && perBlockOk && enough;
  const mask = mode === 'all' ? (1 << BLOCKS) - 1 : maskOf(selected);
  const label = !n
    ? 'TAP SPOTS ON THE MAP'
    : !per
      ? 'ENTER AMOUNT'
      : !perBlockOk
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER SPOT`
        : !enough
          ? 'NOT ENOUGH SOL'
          : `MINE THIS ROUND · ${fmtSol(per)} SOL`;
  const back = n && spot > 0 ? liveReturn(n, spot) : null;
  const hint =
    mode === 'pick' && !n
      ? 'Tap spots on the map to pick them'
      : back
        ? n === BLOCKS
          ? `Always on the gold spot · ${fmtSol(back.strike)} SOL back + ORE`
          : `Strike: ${fmtSol(back.strike)} SOL back + ORE · miss: ${fmtSol(back.miss)} back`
        : mode === 'all'
            ? 'All 25: always on the gold spot'
            : '';
  return (
    <>
      {compact ? null : (
        <>
          <BalanceRow />
          <AmountBox value={perSpot} onChange={setPerSpot} hint="SOL per spot" suffix="per spot" />
          <Row
            icon="grid"
            label="Spots"
            last
            right={
              <T v="num" style={{ fontSize: 18, color: n ? COLORS.text : COLORS.muted }}>
                {n} selected
              </T>
            }
          />
          <View style={[styles.lineRight, { marginTop: 4 }]}>
            <Chip grow label="All 25" on={mode === 'all'} onPress={() => setLiteMode('all')} disabled={Boolean(run)} />
            <Chip grow label="Smart" on={mode === 'smart'} onPress={() => setLiteMode('smart')} disabled={Boolean(run)} />
            <Chip grow label="Pick" on={mode === 'pick'} onPress={() => setLiteMode('pick')} disabled={Boolean(run)} />
          </View>
          {mode === 'smart' ? <SmartCounts value={smartN} onPick={setLiteSmart} disabled={Boolean(run)} /> : null}
          <EvRow squares={mode === 'all' ? [...Array(BLOCKS).keys()] : selected} perSpot={n ? spot : 0} />
          <T v="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 10 }}>
            {hint}
          </T>
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `${fmtSol(spot, 5)} SOL × ${n} spots` : undefined}
        onStart={() =>
          void startRun({ kind: 'lite', perRound: per, perSpot: spot, blocks: mode === 'all' ? 'all' : 'manual', smartN: n, manualMask: mode === 'all' ? 0 : mask, total: 1 })
        }
      />
    </>
  );
}

/* PRO: presets, block picking, manual rounds */
function ProPanel({ compact }: { compact: boolean }) {
  const staked = useGame((s) => s.wallet.player?.stakedSkr ?? 0);
  const { balance, live } = useBalance();
  const presets = useGame((s) => s.save.presets);
  const idx = useGame((s) => s.save.preset);
  const selected = useGame((s) => s.selected);
  const pending = useGame((s) => s.pending);
  const run = useGame((s) => s.run);
  const autopilot = useGame((s) => s.autopilot);
  const busy = useGame((s) => s.wallet.busy);
  const { choosePreset, editPreset, startRun, selectAll, clearSelection } = useGame.getState();
  const p: Preset = presets[idx] ?? presets[0];
  // amount per spot, like other mining boards; older presets stored SOL per round
  const perSpotStr = p.perSpot ?? '0.001';
  const perSpotIn = Number(perSpotStr) || 0;

  const pickSmart = (count?: number) => {
    const n = count ?? ((SMART_COUNTS as readonly number[]).includes(p.smartN) ? p.smartN : DEFAULT_SMART);
    editPreset({ blocks: 'smart', smartN: n });
    useGame.setState({ selected: randomPick(n) });
  };
  const pickAll = () => {
    editPreset({ blocks: 'all', smartN: BLOCKS });
    selectAll();
  };

  const blocks = p.blocks === 'all' ? BLOCKS : p.blocks === 'smart' ? p.smartN : selected.length;
  const perBlock = blocks ? perSpotIn : 0;
  const per = perBlock * blocks; // SOL a round
  // live autopilot runs from an ORE automation: one approval funds it, rounds then need no pop-up
  const rounds = p.rounds;
  const need = per * rounds;
  const enough = need <= balance + 1e-9;
  const ready = blocks > 0 && per > 0 && perBlock >= MIN_SOL_PER_BLOCK && enough && !pending && !(live && autopilot) && !busy;
  const label = !blocks
    ? 'NO CLAIMS SELECTED'
    : !per
      ? 'ENTER AMOUNT'
      : perBlock < MIN_SOL_PER_BLOCK
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER SPOT`
        : !enough
          ? 'NOT ENOUGH SOL'
          : live && autopilot
            ? 'STOP AUTOPILOT FIRST'
            : pending
              ? 'WAIT FOR THIS ROUND'
              : `DEPLOY ${fmtSol(per)} SOL${rounds > 1 ? ` × ${rounds}` : ''}`;
  const solo = useGame((s) => soloOf(s, s.roundId));
  const picked = p.blocks === 'manual' || p.blocks === 'smart' ? selected : [...Array(BLOCKS).keys()];
  const soloCount = picked.filter((i) => solo & (1 << i)).length;

  return (
    <>
      {compact ? null : (
        <>
          <Row icon="bookmark" label="Presets" info="Four saved setups. Changes save to the selected preset." right={null} />
          <View style={[styles.lineRight, { marginTop: 2 }]}>
            {[0, 1, 2, 3].map((i) => (
              <Chip key={i} grow label={`Preset ${i + 1}`} on={i === idx} onPress={() => choosePreset(i)} disabled={Boolean(run)} />
            ))}
          </View>
          <BalanceRow
            onHalf={() => editPreset({ perSpot: trim((balance - RESERVE) / 2 / Math.max(1, rounds) / Math.max(1, blocks)) })}
            onAll={() => editPreset({ perSpot: trim((balance - RESERVE) / Math.max(1, rounds) / Math.max(1, blocks)) })}
          />
          <AmountBox value={perSpotStr} onChange={(v) => editPreset({ perSpot: v })} hint="SOL per spot" suffix="per spot" />
          <Row
            icon="grid"
            label="Spots"
            info="Tap spots on the map to pick them, take All 25, or Smart: 4, 8, 15 or 20 spots at random. Tap a count again for a new set; autopilot rolls new spots every round."
            right={
              <>
                <T v="num" style={{ fontSize: 18, color: blocks ? COLORS.text : COLORS.muted, marginRight: 4 }}>
                  {blocks}
                </T>
                <Chip label="All" on={p.blocks === 'all'} onPress={pickAll} disabled={Boolean(run)} />
                <Chip label="Smart" on={p.blocks === 'smart'} onPress={() => pickSmart()} disabled={Boolean(run)} />
                {selected.length && p.blocks === 'manual' ? <Chip label="Clear" onPress={clearSelection} disabled={Boolean(run)} /> : null}
              </>
            }
          />
          {p.blocks === 'smart' ? <SmartCounts value={p.smartN} onPick={(c) => pickSmart(c)} disabled={Boolean(run)} /> : null}
          <>
          <Row
            icon="hourglass"
            label="Rounds"
            info={live ? `1 = this round only (you approve in your wallet). More = autopilot: one wallet approval funds ORE's automation with SOL for every round, then rounds deploy with no pop-up while the app stays open. Smart re-picks every round. Stop it any time to get the unused SOL back (the Gali fee is paid up front and not refunded).` : '1 = this round only. More = autopilot repeats the same setup each round (Smart re-picks every round).'}
            right={
              <>
                <View style={[styles.tag, p.rounds > 1 && { borderColor: COLORS.teal }]}>
                  <T v="display" style={{ fontSize: 14, lineHeight: 15, letterSpacing: 1, color: p.rounds > 1 ? COLORS.teal : COLORS.muted }}>
                    {p.rounds > 1 ? 'AUTO' : 'MANUAL'}
                  </T>
                </View>
                <Chip label="−" onPress={() => editPreset({ rounds: Math.max(1, p.rounds - 1) })} disabled={Boolean(run)} />
                <T v="num" style={{ fontSize: 18, minWidth: 22, textAlign: 'center' }}>
                  {p.rounds}
                </T>
                <Chip label="+" onPress={() => editPreset({ rounds: Math.min(100, p.rounds + 1) })} disabled={Boolean(run)} />
              </>
            }
          />
          </>
          <AutopilotRow />
          {TV_PAIR && live && !autopilot ? (
            <Row
              icon="bot"
              label="Play on a TV"
              info="Gali: ORE Island on Android TV shows a QR when you press START MINING. Scan it with your camera, or tap SCAN TV and type its code, then approve one all-spots autopilot. The TV presses deploy and shows your strikes; your SOL stays in ORE's autopilot."
              right={<Chip label="SCAN TV" onPress={openScanTv} disabled={Boolean(busy)} />}
            />
          ) : null}
          <EvRow squares={picked} perSpot={blocks ? perBlock : 0} />
          <Row
            icon="trophy"
            label="If it strikes"
            info={live ? LIVE_INFO : `Only the gold spot mines ORE. The ORE is split by SOL there, unless it is one of this round's 10 solo spots (★ on the map): then one miner takes it all, with odds equal to their share. A 1-in-500 motherlode pays the whole SKR Motherlode Pool on top, split by SOL on the gold spot, plus 10,000 points. Points: 40 x 25 / spots covered. ${RETURN_INFO}`}
            last
            right={
              <T v="num" style={{ fontSize: 16, color: COLORS.gold }}>
                {!blocks ? '—' : live ? `${FEATURE_GALI_PROGRAM ? `+${pointsFor(blocks, false, 10_000)} pts · ` : ''}${Math.round((blocks / BLOCKS) * 100)}% odds · ${soloCount} ★` : `+${pointsFor(blocks, false, boostFor(staked))} pts · ${Math.round((blocks / BLOCKS) * 100)}% odds · ${soloCount} ★`}
              </T>
            }
          />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={
          ready
            ? `${fmtSol(perBlock, 5)} SOL × ${blocks} spot${blocks > 1 ? 's' : ''} · ${
`strike: ${fmtSol(liveReturn(blocks, perBlock).strike)} SOL back + ORE`
              }`
            : undefined
        }
        onStart={() =>
          void startRun({
            kind: 'pro',
            perRound: per,
            perSpot: perBlock,
            blocks: p.blocks,
            smartN: p.smartN,
            manualMask: maskOf(selected),
            total: rounds,
          })
        }
      />
    </>
  );
}

// browsers draw a focus box around inputs; the field frame already shows focus
const WEB_NO_OUTLINE = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 16,
  },
  dockFill: { position: 'absolute', bottom: 0 },
  embedded: { gap: 0 },
  handle: { position: 'absolute', top: 5, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 2 },
  handleBar: { width: 36, height: U * 2, backgroundColor: '#3a5290' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  seg: { flex: 1, flexDirection: 'row', backgroundColor: '#04060f', padding: U, gap: U },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  runDot: { width: U * 3, height: U * 3, backgroundColor: COLORS.teal },
  fold: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 7, borderBottomWidth: U, borderColor: 'rgba(34,53,111,0.6)', borderStyle: 'dashed', minHeight: 44 },
  lineLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  evWrap: { borderBottomWidth: U, borderColor: 'rgba(34,53,111,0.6)', borderStyle: 'dashed', paddingBottom: 7 },
  evPill: { paddingHorizontal: 8, paddingVertical: 3 },
  evNote: { fontSize: 14, lineHeight: 16, color: COLORS.muted, marginTop: -2 },
  lineRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  botPanel: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12, gap: 8 },
  botStrip: { flexDirection: 'row', gap: 8 },
  roundNowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, borderBottomWidth: U, borderColor: 'rgba(34,53,111,0.6)', borderStyle: 'dashed' },
  rulesLine: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: 'rgba(4,6,15,0.55)', borderWidth: U, borderColor: 'rgba(34,53,111,0.8)' },
  botCell: { flex: 1, minWidth: 0, paddingVertical: 6, paddingHorizontal: 8, gap: 1, backgroundColor: 'rgba(4,6,15,0.55)', borderWidth: U, borderColor: 'rgba(34,53,111,0.8)' },
  aiSpot: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 34, width: 120 },
  aiSpotInput: { position: 'relative', width: 64, height: 30, textAlign: 'right', color: COLORS.gold, fontFamily: F.display, fontSize: 18, paddingVertical: 0, paddingHorizontal: 0, ...WEB_NO_OUTLINE },
  aiComment: { minHeight: 56, paddingHorizontal: 10, paddingVertical: 6 },
  aiCommentInput: { position: 'relative', minHeight: 44, color: COLORS.text, fontFamily: F.body, fontSize: 15, textAlignVertical: 'top', paddingVertical: 0, paddingHorizontal: 0, ...WEB_NO_OUTLINE },
  aiLog: { gap: 3, paddingVertical: 8, borderBottomWidth: U, borderColor: 'rgba(34,53,111,0.6)', borderStyle: 'dashed' },
  info: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
  chipGrow: { flex: 1, minWidth: 0 },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 56,
    marginTop: 8,
    overflow: 'hidden',
  },
  token: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, borderRightWidth: U, borderColor: '#22356f', flexShrink: 0, height: 30 },
  inputWrap: { flex: 1, minWidth: 0, marginLeft: 10 },
  input: { width: '100%', minWidth: 0, textAlign: 'right', color: COLORS.gold, fontFamily: F.display, fontSize: 28, paddingVertical: 0, paddingHorizontal: 0, ...WEB_NO_OUTLINE },
  uRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unclaimedBoxed: { marginBottom: 0 },
  unclaimed: {
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
    borderWidth: U,
    borderColor: 'rgba(255,207,74,0.45)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(4,8,22,0.6)',
  },
  tag: { borderWidth: U, borderColor: '#22356f', paddingHorizontal: 6, paddingVertical: 1 },
  holdRows: { marginTop: 10, gap: 4 },
  holdRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(4,6,15,0.55)' },
  holdCheck: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', marginTop: 10, paddingVertical: 4 },
  holdBox: { width: 14, height: 14, borderWidth: U, borderColor: COLORS.gold },
  big: { alignItems: 'center', paddingTop: 0, paddingBottom: 2 },
  bigInput: { width: '100%', textAlign: 'center', color: COLORS.gold, fontFamily: F.display, fontSize: 48, lineHeight: 52, paddingVertical: 0, paddingHorizontal: 0, ...WEB_NO_OUTLINE },
  bigBal: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
});
