import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CLUSTER, LIVE_AUTOPILOT_MAX_SOL, LIVE_MAX_ROUND_SOL, REFINING_FEE } from '../chain/light';
import { BLOCKS, boostFor, COLORS, pointsFor } from '../game/constants';
import { watchMotion } from '../game/motion';
import { DEFAULT_SMART, fmtSol, liveReturn, maskOf, randomPick, MIN_SOL_PER_BLOCK, SMART_COUNTS } from '../game/pot';
import { isLive, isOnChain, soloOf, useGame, type DockTab, type Preset } from '../game/store';
import { fx } from '../pixel/fx';
import { useView } from '../pixel/view';
import { LinearGradient } from 'expo-linear-gradient';
import { Btn, F, Gem, T } from './kit';
import { BAR_H } from './TabBar';

const SHAKE_G = 2.1;
const TABS: { id: DockTab; label: string }[] = [
  { id: 'lite', label: 'LITE' },
  { id: 'pro', label: 'PRO' },
];

export function Dock() {
  const insets = useSafeAreaInsets();
  const tab = useGame((s) => s.dockTab);
  const run = useGame((s) => s.run);
  const setTab = useGame((s) => s.setDockTab);
  const open = useGame((s) => s.dockOpen);
  const setOpen = useGame((s) => s.setDockOpen);
  const compact = false;
  const inside = useView((s) => s.focus >= 0);

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
    if (!open) fx.viewBottom = barTop + 6;
  }, [open, barTop]);
  if (!open) return null;

  return (
    <View
      style={[styles.dock, { bottom: barTop, paddingBottom: 10 }, inside && { display: 'none' }]}
      onLayout={(e) => {
        fx.viewBottom = e.nativeEvent.layout.height + barTop + 10;
      }}
    >
      <LinearGradient colors={['#15285a', '#0c1838', '#070d20']} style={[StyleSheet.absoluteFill, styles.dockBg]} />
      <View pointerEvents="none" style={styles.dockLit} />
      <Gem size={10} style={styles.dockGem} />
      <Pressable onPress={() => setOpen(false)} hitSlop={8} style={styles.handle} accessibilityRole="button" accessibilityLabel="Close the mine panel">
        <View style={styles.handleBar} />
      </Pressable>
      <View style={styles.head}>
        <View style={styles.seg}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.segBtn, on && styles.segOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                {on ? <LinearGradient colors={['#2c56a8', '#173069']} style={[StyleSheet.absoluteFill, { borderRadius: 8 }]} /> : null}
                <T v="display" style={{ fontSize: 13, letterSpacing: 2, color: on ? COLORS.gold : COLORS.muted }}>
                  {t.label}
                  {run?.kind === t.id ? ' ●' : ''}
                </T>
                {on ? <View style={styles.segUnder} /> : null}
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => setOpen(false)} style={styles.fold} accessibilityRole="button" accessibilityLabel="Close the mine panel">
          <T v="display" style={{ fontSize: 14, color: COLORS.gold }}>
            ▾
          </T>
        </Pressable>
      </View>
      <UnclaimedRow />
      {tab === 'lite' ? <LitePanel compact={compact} /> : <ProPanel compact={compact} />}
    </View>
  );
}

/* ---------------- shared bits ---------------- */
const RETURN_INFO =
  "ORE keeps 1% of every spot and 10% more of spots that miss. The rest of your SOL comes back to claim. Covering all 25 spots means you always hit, so you mine every round, but you pay the 10% on the 24 spots that miss.";

const LIVE_INFO =
  "Only the gold spot mines ORE: split by SOL there, or all to one miner on a ★ solo spot, with odds equal to their share. ORE keeps 1% of every spot and 10% more of spots that miss. The rest of your SOL comes back to claim. One round in 500 also pays ORE's motherlode, split by SOL on the gold spot.";

/** Unclaimed SOL and SKR from finished rounds, each with its own Claim button. */
export function UnclaimedRow() {
  const onChain = useGame(isOnChain);
  const sol = useGame((s) => (onChain ? s.wallet.unclaimed.sol : (s.save.practiceUnclaimedSol ?? 0)));
  const unrefined = useGame((s) => (onChain ? s.wallet.unclaimed.unrefined : (s.save.practiceUnclaimedSkr ?? 0)));
  const refined = useGame((s) => (onChain ? s.wallet.unclaimed.refined : (s.save.practiceRefinedSkr ?? 0)));
  const busy = useGame((s) => s.wallet.busy);
  const claim = useGame((s) => s.claimRewards);
  const fee = useGame((s) => (onChain ? s.wallet.unclaimed.fee : (s.save.practiceUnclaimedSkr ?? 0) * REFINING_FEE));
  // nothing to claim yet: give the island the room
  if (sol < 0.00005 && unrefined < 0.005 && refined < 0.005) return null;
  return (
    <View style={styles.unclaimed} accessibilityLabel={`Unclaimed ${sol.toFixed(4)} SOL, ${Math.floor(unrefined)} unrefined ORE, ${Math.floor(refined)} refined ORE`}>
      <View style={styles.uRow}>
        <T style={{ fontSize: 13 }}>🎁</T>
        <T v="label" style={{ color: COLORS.muted }}>
          Unclaimed
        </T>
        <Info
          text={`Finished rounds credit your SOL and the ORE you mined here${onChain ? ' (held by ORE for your wallet)' : ''}. SOL claims are free. Unrefined ORE pays ORE's own 10% fee when you claim it, and that fee is shared with everyone still holding theirs, as refined ORE you can claim with no fee. The longer you hold, the more refined ORE you collect.`}
        />
        <T v="black" numberOfLines={1} style={{ flex: 1, fontSize: 13, color: COLORS.sol, textAlign: 'right' }}>
          {fmtSol(sol)} SOL
        </T>
        <Chip label="CLAIM" on={sol > 0} disabled={!(sol > 0) || Boolean(busy)} onPress={() => void claim('sol')} />
      </View>
      <View style={styles.uRow}>
        <T v="muted" numberOfLines={1} style={{ flex: 1, fontSize: 11 }}>
          {fmtAmt(unrefined)} unrefined · +{fmtAmt(refined)} refined
          {fee > 0.00005 ? ` · fee ${fmtAmt(fee)}` : ''}
        </T>
        <T v="black" numberOfLines={1} style={{ fontSize: 13, color: COLORS.skr }}>
          {fmtAmt(unrefined - fee + refined)} ORE
        </T>
        <Chip label="CLAIM" on={unrefined + refined > 0} disabled={!(unrefined + refined > 0) || Boolean(busy)} onPress={() => void claim('skr')} />
      </View>
    </View>
  );
}

/** Small ORE amounts keep their decimals; big practice numbers stay whole. */
const fmtAmt = (v: number) => (v >= 100 ? Math.floor(v).toLocaleString() : v.toFixed(v >= 1 ? 2 : 4));

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
  return (
    <Pressable onPress={() => toast(text, 'info')} hitSlop={10} accessibilityLabel="More info" style={styles.info}>
      <T v="black" style={{ fontSize: 10, color: COLORS.muted }}>
        i
      </T>
    </Pressable>
  );
}

function Row({ icon, label, info, right, last }: { icon: string; label: string; info?: string; right: ReactNode; last?: boolean }) {
  return (
    <View style={[styles.line, last && { borderBottomWidth: 0 }]}>
      <View style={styles.lineLeft}>
        <T style={{ fontSize: 13 }}>{icon}</T>
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
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn, grow && styles.chipGrow, disabled && { opacity: 0.4 }]}>
      <T v="black" numberOfLines={1} style={{ fontSize: 12, color: on ? COLORS.gold : COLORS.muted, textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}

function BalanceRow({ onHalf, onAll }: { onHalf?: () => void; onAll?: () => void }) {
  const { balance, onChain, live } = useBalance();
  const refill = useGame((s) => s.refillPractice);
  const airdrop = useGame((s) => s.airdrop);
  return (
    <View style={[styles.lineRight, { justifyContent: 'space-between', marginTop: 10 }]}>
      <View style={styles.lineLeft}>
        <T style={{ fontSize: 13 }}>👛</T>
        <T v="bold" style={{ fontSize: 13 }}>
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
    <View style={styles.amount}>
      <View style={styles.token}>
        <View style={styles.solMark}>
          <T v="black" style={{ fontSize: 12, color: '#040817' }}>
            ◎
          </T>
        </View>
        <T v="black" style={{ fontSize: 16 }}>
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
        <T v="bold" style={{ marginLeft: 8, fontSize: 12, color: COLORS.muted }}>
          {suffix}
        </T>
      ) : null}
    </View>
  );
}

const trim = (v: number) => (v > 0 ? String(Math.floor(v * 1e4) / 1e4) : '');
const RESERVE = 0.01; // leave room for fees and rent

function RunButton({ ready, label, sub, onStart }: { ready: boolean; label: string; sub?: string; onStart: () => void }) {
  const run = useGame((s) => s.run);
  const stop = useGame((s) => s.stopRun);
  const busy = useGame((s) => s.wallet.busy);
  if (run)
    return (
      <Btn
        label={`■ STOP · ${run.total - run.left}/${run.total} rounds`}
        sub={`${fmtSol(run.perRound)} SOL a round · ${run.kind.toUpperCase()}`}
        onPress={stop}
        style={{ marginTop: 10, borderColor: COLORS.red }}
      />
    );
  const start = () => {
    onStart();
    useGame.getState().setDockOpen(false);
  };
  return <Btn kind={ready ? 'gold' : 'plain'} label={busy ?? label} sub={sub} onPress={start} disabled={!ready || Boolean(busy)} style={{ marginTop: 10, minHeight: 54 }} />;
}

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

/* ---------------- LITE: one round; All 25, Smart (random) or spots tapped on the map ---------------- */
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
  const capped = live && per > LIVE_MAX_ROUND_SOL + 1e-9;
  const ready = n > 0 && per > 0 && perBlockOk && enough && !capped;
  const mask = mode === 'all' ? (1 << BLOCKS) - 1 : maskOf(selected);
  const label = !n
    ? 'TAP SPOTS ON THE MAP'
    : !per
      ? 'ENTER AMOUNT'
      : !perBlockOk
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER SPOT`
        : !enough
          ? 'NOT ENOUGH SOL'
          : capped
            ? `MAX ${LIVE_MAX_ROUND_SOL} SOL A ROUND`
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
            icon="▦"
            label="Spots"
            last
            right={
              <T v="black" style={{ fontSize: 15, color: n ? COLORS.text : COLORS.muted }}>
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

/* ---------------- PRO: presets, block picking, manual rounds ---------------- */
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
  const capped = live && per > LIVE_MAX_ROUND_SOL + 1e-9;
  const autoCapped = live && rounds > 1 && need > LIVE_AUTOPILOT_MAX_SOL + 1e-9;
  const ready = blocks > 0 && per > 0 && perBlock >= MIN_SOL_PER_BLOCK && enough && !pending && !capped && !autoCapped && !(live && autopilot) && !busy;
  const label = !blocks
    ? 'NO CLAIMS SELECTED'
    : !per
      ? 'ENTER AMOUNT'
      : perBlock < MIN_SOL_PER_BLOCK
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER SPOT`
        : !enough
          ? 'NOT ENOUGH SOL'
          : capped
            ? `MAX ${LIVE_MAX_ROUND_SOL} SOL A ROUND`
            : autoCapped
              ? `AUTOPILOT MAX ${LIVE_AUTOPILOT_MAX_SOL} SOL`
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
          <Row icon="🔖" label="Presets" info="Four saved setups. Changes save to the selected preset." right={null} />
          <View style={[styles.lineRight, { marginTop: 2 }]}>
            {[0, 1, 2, 3].map((i) => (
              <Chip key={i} grow label={`Preset ${i + 1}`} on={i === idx} onPress={() => choosePreset(i)} disabled={Boolean(run)} />
            ))}
          </View>
          <BalanceRow
            onHalf={() => editPreset({ perSpot: trim((balance - RESERVE) / 2 / Math.max(1, rounds) / Math.max(1, blocks)) })}
            onAll={() => editPreset({ perSpot: trim((Math.min(balance - RESERVE, live ? LIVE_MAX_ROUND_SOL : Infinity)) / Math.max(1, rounds) / Math.max(1, blocks)) })}
          />
          <AmountBox value={perSpotStr} onChange={(v) => editPreset({ perSpot: v })} hint="SOL per spot" suffix="per spot" />
          <Row
            icon="▦"
            label="Spots"
            info="Tap spots on the map to pick them, take All 25, or Smart: 4, 8, 15 or 20 spots at random. Tap a count again for a new set; autopilot rolls new spots every round."
            right={
              <>
                <T v="black" style={{ fontSize: 15, color: blocks ? COLORS.text : COLORS.muted, marginRight: 4 }}>
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
            icon="🔁"
            label="Rounds"
            info={live ? `1 = this round only (you approve in your wallet). More = autopilot: one wallet approval funds ORE's automation with SOL for every round, then rounds deploy with no pop-up while the app stays open. Smart re-picks every round. Up to ${LIVE_AUTOPILOT_MAX_SOL} SOL in total. Stop it any time to get the unused SOL back.` : '1 = this round only. More = autopilot repeats the same setup each round (Smart re-picks every round).'}
            right={
              <>
                <View style={[styles.tag, p.rounds > 1 && { borderColor: COLORS.teal }]}>
                  <T v="black" style={{ fontSize: 9, letterSpacing: 1, color: p.rounds > 1 ? COLORS.teal : COLORS.muted }}>
                    {p.rounds > 1 ? 'AUTO' : 'MANUAL'}
                  </T>
                </View>
                <Chip label="−" onPress={() => editPreset({ rounds: Math.max(1, p.rounds - 1) })} disabled={Boolean(run)} />
                <T v="black" style={{ fontSize: 15, minWidth: 22, textAlign: 'center' }}>
                  {p.rounds}
                </T>
                <Chip label="+" onPress={() => editPreset({ rounds: Math.min(100, p.rounds + 1) })} disabled={Boolean(run)} />
              </>
            }
          />
          </>
          {live && autopilot ? (
            <Row
              icon="🤖"
              label="Autopilot on"
              info="Your SOL sits in ORE's automation and is deployed round by round while this app is open. Stopping closes it and sends what is left back to your wallet."
              right={
                <>
                  <T v="black" style={{ fontSize: 12, color: COLORS.teal, marginRight: 6 }}>
                    {fmtSol(autopilot.balance)} SOL left
                  </T>
                  <Chip label="STOP" onPress={() => void useGame.getState().stopAutopilot()} disabled={Boolean(busy)} />
                </>
              }
            />
          ) : null}
          <Row
            icon="🏆"
            label="If it strikes"
            info={live ? LIVE_INFO : `Only the gold spot mines ORE. The ORE is split by SOL there, unless it is one of this round's 10 solo spots (★ on the map): then one miner takes it all, with odds equal to their share. A 1-in-500 motherlode pays the whole SKR Motherlode Pool on top, split by SOL on the gold spot, plus 10,000 points. Points: 40 x 25 / spots covered. ${RETURN_INFO}`}
            last
            right={
              <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
                {!blocks ? '—' : live ? `+${pointsFor(blocks, false, 10_000)} pts · ${Math.round((blocks / BLOCKS) * 100)}% odds · ${soloCount} ★` : `+${pointsFor(blocks, false, boostFor(staked))} pts · ${Math.round((blocks / BLOCKS) * 100)}% odds · ${soloCount} ★`}
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
    paddingTop: 14,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderColor: COLORS.trim,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 12,
  },
  dockBg: { borderTopLeftRadius: 21, borderTopRightRadius: 21 },
  dockLit: { position: 'absolute', top: 0, left: 40, right: 40, height: 1, backgroundColor: COLORS.trimHi, opacity: 0.8 },
  dockGem: { position: 'absolute', top: -6, alignSelf: 'center' },
  handle: { position: 'absolute', top: 4, alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 2 },
  handleBar: { width: 38, height: 4, borderRadius: 2, backgroundColor: COLORS.line },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  seg: { flex: 1, flexDirection: 'row', backgroundColor: '#02061499', borderRadius: 10, padding: 3, borderWidth: 1, borderColor: COLORS.line },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8, overflow: 'hidden' },
  segOn: { borderWidth: 1, borderColor: '#5d8ae0' },
  segUnder: { position: 'absolute', bottom: 0, left: '30%', right: '30%', height: 2, backgroundColor: COLORS.gold, borderRadius: 1 },
  fold: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.trim,
    backgroundColor: '#02061499',
  },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 7, borderBottomWidth: 1, borderColor: '#2a448055', minHeight: 42 },
  lineLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  lineRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  info: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: COLORS.muted, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#0a1636' },
  chipOn: { borderColor: COLORS.gold, backgroundColor: '#ffcf4a1f' },
  chipGrow: { flex: 1, minWidth: 0, paddingHorizontal: 4 },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.trim,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 54,
    marginTop: 8,
    backgroundColor: '#020614cc',
    overflow: 'hidden',
  },
  token: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, borderRightWidth: 1, borderColor: COLORS.line, flexShrink: 0 },
  solMark: { width: 22, height: 22, borderRadius: 6, backgroundColor: COLORS.sol, alignItems: 'center', justifyContent: 'center' },
  inputWrap: { flex: 1, minWidth: 0, marginLeft: 10 },
  input: { width: '100%', minWidth: 0, textAlign: 'right', color: COLORS.gold, fontFamily: F.display, fontSize: 24, paddingVertical: 0, paddingHorizontal: 0, ...WEB_NO_OUTLINE },
  small: {
    width: 72,
    textAlign: 'right',
    color: COLORS.text,
    fontFamily: F.display,
    fontSize: 14,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 7,
    backgroundColor: '#020614aa',
    ...WEB_NO_OUTLINE,
  },
  uRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unclaimed: {
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: '#02061488',
  },
  tag: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
});
