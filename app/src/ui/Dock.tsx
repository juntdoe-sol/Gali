import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chainReady, REFINING_FEE } from '../chain/light';
import { BLOCKS, boostFor, COLORS, pointsFor } from '../game/constants';
import { watchMotion } from '../game/motion';
import { addToPot, fmtSol, maskOf, strikeRange, MIN_SOL_PER_BLOCK, OPTIMAL_ROUNDS, optimalPerSpot, smartPick, soloMask } from '../game/pot';
import { useGame, type DockTab, type Preset } from '../game/store';
import { fx } from '../pixel/fx';
import { LinearGradient } from 'expo-linear-gradient';
import { Btn, F, Gem, T } from './kit';

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
  const [folded, setFolded] = useState<boolean | null>(null);
  const compact = folded ?? Boolean(run);

  // shake the phone to Smart-pick the emptiest blocks
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

  return (
    <View
      style={[styles.dock, { paddingBottom: insets.bottom + (compact ? 8 : 10) }]}
      onLayout={(e) => {
        fx.viewBottom = e.nativeEvent.layout.height + 10;
      }}
    >
      <LinearGradient colors={['#15285a', '#0c1838', '#070d20']} style={[StyleSheet.absoluteFill, styles.dockBg]} />
      <View pointerEvents="none" style={styles.dockLit} />
      <Gem size={10} style={styles.dockGem} />
      <Pressable
        onPress={() => setFolded(!compact)}
        hitSlop={8}
        style={styles.handle}
        accessibilityRole="button"
        accessibilityLabel={compact ? 'Expand deploy panel' : 'Minimize deploy panel'}
      >
        <View style={styles.handleBar} />
      </Pressable>
      <View style={styles.head}>
        <View style={styles.seg}>
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <Pressable
                key={t.id}
                onPress={() => {
                  if (on) setFolded(!compact);
                  else {
                    setTab(t.id);
                    setFolded(null);
                  }
                }}
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
        <Pressable
          onPress={() => setFolded(!compact)}
          style={styles.fold}
          accessibilityRole="button"
          accessibilityLabel={compact ? 'Expand panel' : 'Minimize panel'}
        >
          <T v="display" style={{ fontSize: 14, color: COLORS.gold, transform: [{ rotate: compact ? '180deg' : '0deg' }] }}>
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
  "Only the gold claim gets paid. Its miners split the whole pot (their SOL plus the SOL on every other claim) by their share of the gold claim, after fees: 1% of every claim and 10% of the losing claims. SOL on the other claims is lost. Covering all 25 claims means you always hit, but you pay the losing claims' SOL to yourself and the others, so you only profit when others put less on the claim that strikes.";

/** Pot as it will look with this deploy added (practice already includes a pending deploy). */
function usePotWith(mask: number, perBlock: number) {
  const pot = useGame((s) => s.pot);
  const pending = useGame((s) => s.pending);
  if (!mask || !(perBlock > 0)) return null;
  return pending ? pot : addToPot(pot, mask, perBlock);
}
const fmtRange = (r: { lo: number; hi: number } | null) =>
  !r ? '—' : Math.abs(r.hi - r.lo) < 0.00005 ? fmtSol(r.lo) : `${fmtSol(r.lo)}–${fmtSol(r.hi)}`;

/** Unclaimed SOL and SKR from finished rounds, each with its own Claim button. */
export function UnclaimedRow() {
  const owner = useGame((s) => s.wallet.owner);
  const onChain = Boolean(owner && chainReady);
  const sol = useGame((s) => (onChain ? s.wallet.unclaimed.sol : (s.save.practiceUnclaimedSol ?? 0)));
  const unrefined = useGame((s) => (onChain ? s.wallet.unclaimed.unrefined : (s.save.practiceUnclaimedSkr ?? 0)));
  const refined = useGame((s) => (onChain ? s.wallet.unclaimed.refined : (s.save.practiceRefinedSkr ?? 0)));
  const busy = useGame((s) => s.wallet.busy);
  const claim = useGame((s) => s.claimRewards);
  const fee = useGame((s) => (onChain ? s.wallet.unclaimed.fee : (s.save.practiceUnclaimedSkr ?? 0) * REFINING_FEE));
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
          {Math.floor(unrefined).toLocaleString()} unrefined · +{refined < 10 ? refined.toFixed(2) : Math.floor(refined).toLocaleString()} refined
          {fee >= 1 ? ` · fee ${Math.floor(fee).toLocaleString()}` : ''}
        </T>
        <T v="black" numberOfLines={1} style={{ fontSize: 13, color: COLORS.skr }}>
          {(unrefined - fee + refined).toFixed(2)} ORE
        </T>
        <Chip label="CLAIM" on={unrefined + refined > 0} disabled={!(unrefined + refined > 0) || Boolean(busy)} onPress={() => void claim('skr')} />
      </View>
    </View>
  );
}

function useBalance() {
  const owner = useGame((s) => s.wallet.owner);
  const sol = useGame((s) => s.wallet.sol + s.wallet.sessionSol);
  const practice = useGame((s) => s.save.practiceSol);
  const onChain = Boolean(owner && chainReady);
  return { onChain, balance: onChain ? sol : practice };
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

function BalanceRow({ onHalf, onAll }: { onHalf: () => void; onAll: () => void }) {
  const { balance, onChain } = useBalance();
  const refill = useGame((s) => s.refillPractice);
  const airdrop = useGame((s) => s.airdrop);
  return (
    <View style={[styles.lineRight, { justifyContent: 'space-between', marginTop: 10 }]}>
      <View style={styles.lineLeft}>
        <T style={{ fontSize: 13 }}>👛</T>
        <T v="bold" style={{ fontSize: 13 }}>
          {balance.toFixed(4)}
        </T>
        <T v="muted">{onChain ? 'SOL' : 'practice SOL'}</T>
        <Chip label={onChain ? '+1 devnet' : 'Refill'} onPress={onChain ? airdrop : refill} />
      </View>
      <View style={styles.lineRight}>
        <Chip label="Half" onPress={onHalf} />
        <Chip label="All" onPress={onAll} />
      </View>
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
  return <Btn kind={ready ? 'gold' : 'plain'} label={busy ?? label} sub={sub} onPress={onStart} disabled={!ready || Boolean(busy)} style={{ marginTop: 10, minHeight: 54 }} />;
}

/* ---------------- LITE: SOL per spot on all 25, one round or many ---------------- */
function LitePanel({ compact }: { compact: boolean }) {
  const { balance } = useBalance();
  const startRun = useGame((s) => s.startRun);
  const [perSpot, setPerSpot] = useState('0.0004');
  const [rounds, setRounds] = useState(1);
  const spot = Number(perSpot) || 0;
  const per = spot * BLOCKS; // SOL a round
  const need = per * rounds;
  const maxRounds = per > 0 ? Math.max(1, Math.floor((balance - RESERVE) / per)) : 1;
  const perBlockOk = spot >= MIN_SOL_PER_BLOCK;
  const enough = need <= balance + 1e-9;
  const ready = per > 0 && rounds > 0 && perBlockOk && enough;
  const ALL = (1 << BLOCKS) - 1;
  const potWith = usePotWith(ALL, spot);
  const range = potWith ? strikeRange(potWith, ALL, spot) : null;
  const label = !per
    ? 'ENTER AMOUNT'
    : !perBlockOk
      ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER CLAIM`
      : !enough
        ? 'NOT ENOUGH SOL'
        : rounds === 1
          ? `MINE THIS ROUND · ${fmtSol(per)} SOL`
          : `AUTOPILOT ${rounds} ROUNDS · ${fmtSol(need)} SOL`;
  return (
    <>
      {compact ? null : (
        <>
          <BalanceRow
            onHalf={() => setPerSpot(trim((balance - RESERVE) / 2 / BLOCKS / Math.max(1, rounds)))}
            onAll={() => setPerSpot(trim((balance - RESERVE) / BLOCKS / Math.max(1, rounds)))}
          />
          <AmountBox value={perSpot} onChange={setPerSpot} hint="SOL per claim" suffix="per claim" />
          <Row
            icon="🪙"
            label="A round costs"
            info={`LITE puts the same SOL on all 25 claims, so you are always on the gold claim. ${fmtSol(spot, 5)} a claim is ${fmtSol(per)} SOL a round. Minimum ${MIN_SOL_PER_BLOCK} SOL a claim. Optimal spreads your balance over ${OPTIMAL_ROUNDS} rounds.`}
            right={
              <>
                <Chip label="Optimal" onPress={() => setPerSpot(trim(optimalPerSpot(balance - RESERVE)))} />
                <T v="black" style={{ fontSize: 13, color: per ? COLORS.text : COLORS.muted }}>
                  {per ? `${fmtSol(per)} SOL` : '—'}
                </T>
              </>
            }
          />
          <Row
            icon="🏆"
            label="SOL if it strikes"
            info={RETURN_INFO}
            right={
              <T v="black" numberOfLines={1} style={{ fontSize: 13, color: range ? COLORS.sol : COLORS.muted }}>
                {range ? `${fmtRange(range)} a round` : '—'}
              </T>
            }
          />
          <Row
            icon="🔁"
            label="Rounds"
            info="1 = mine this round only, no autopilot. More = the same deploy every round until they are used up. Keep the app open; you can stop any time."
            last
            right={
              <>
                <View style={[styles.tag, rounds > 1 && { borderColor: COLORS.teal }]}>
                  <T v="black" style={{ fontSize: 9, letterSpacing: 1, color: rounds > 1 ? COLORS.teal : COLORS.muted }}>
                    {rounds > 1 ? 'AUTO' : 'MANUAL'}
                  </T>
                </View>
                <Chip label="−" onPress={() => setRounds(Math.max(1, rounds - 1))} />
                <T v="black" style={{ fontSize: 15, minWidth: 22, textAlign: 'center' }}>
                  {rounds}
                </T>
                <Chip label="+" onPress={() => setRounds(Math.min(100, rounds + 1))} />
                <Chip label="Max" onPress={() => setRounds(Math.min(100, maxRounds))} />
              </>
            }
          />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `${fmtSol(spot, 5)} SOL × 25 claims${rounds > 1 ? ` × ${rounds} rounds` : ''} · always on the gold claim` : undefined}
        onStart={() => void startRun({ kind: 'lite', perRound: per, perSpot: spot, blocks: 'all', smartN: BLOCKS, manualMask: 0, total: rounds })}
      />
    </>
  );
}

/* ---------------- PRO: presets, block picking, manual rounds ---------------- */
function ProPanel({ compact }: { compact: boolean }) {
  const staked = useGame((s) => s.wallet.player?.stakedSkr ?? 0);
  const { balance } = useBalance();
  const presets = useGame((s) => s.save.presets);
  const idx = useGame((s) => s.save.preset);
  const selected = useGame((s) => s.selected);
  const pot = useGame((s) => s.pot);
  const pending = useGame((s) => s.pending);
  const run = useGame((s) => s.run);
  const { choosePreset, editPreset, startRun, selectAll, clearSelection } = useGame.getState();
  const p: Preset = presets[idx] ?? presets[0];
  // amount per spot, like other mining boards; older presets stored SOL per round
  const perSpotStr = p.perSpot ?? '0.001';
  const perSpotIn = Number(perSpotStr) || 0;

  const pickSmart = () => {
    const n = selected.length || p.smartN || 5;
    editPreset({ blocks: 'smart', smartN: n });
    useGame.setState({ selected: smartPick(pot.perBlock, n) });
  };
  const pickAll = () => {
    editPreset({ blocks: 'all', smartN: BLOCKS });
    selectAll();
  };

  const blocks = p.blocks === 'all' ? BLOCKS : p.blocks === 'smart' ? p.smartN : selected.length;
  const perBlock = blocks ? perSpotIn : 0;
  const per = perBlock * blocks; // SOL a round
  const need = per * p.rounds;
  const enough = need <= balance + 1e-9;
  const ready = blocks > 0 && per > 0 && perBlock >= MIN_SOL_PER_BLOCK && enough && !pending;
  const label = !blocks
    ? 'NO CLAIMS SELECTED'
    : !per
      ? 'ENTER AMOUNT'
      : perBlock < MIN_SOL_PER_BLOCK
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER CLAIM`
        : !enough
          ? 'NOT ENOUGH SOL'
          : pending
            ? 'WAIT FOR THIS ROUND'
            : `DEPLOY ${fmtSol(per)} SOL${p.rounds > 1 ? ` × ${p.rounds}` : ''}`;
  const roundId = useGame((s) => s.roundId);
  const solo = soloMask(roundId);
  const picked = p.blocks === 'manual' || p.blocks === 'smart' ? selected : [...Array(BLOCKS).keys()];
  const soloCount = picked.filter((i) => solo & (1 << i)).length;
  const proMask = p.blocks === 'all' ? (1 << BLOCKS) - 1 : maskOf(picked);
  const proPot = usePotWith(proMask, perBlock);
  const proRange = proPot ? strikeRange(proPot, proMask, perBlock) : null;
  const onWin = selected.length ? Math.min(...selected.map((i) => pot.perBlock[i] ?? 0)) : 0;
  const bestShare = perBlock > 0 ? perBlock / (onWin + perBlock) : 0;

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
            onHalf={() => editPreset({ perSpot: trim((balance - RESERVE) / 2 / Math.max(1, p.rounds) / Math.max(1, blocks)) })}
            onAll={() => editPreset({ perSpot: trim((balance - RESERVE) / Math.max(1, p.rounds) / Math.max(1, blocks)) })}
          />
          <AmountBox value={perSpotStr} onChange={(v) => editPreset({ perSpot: v })} hint="SOL per claim" suffix="per claim" />
          <Row
            icon="▦"
            label="Claims"
            info="Tap claims on the map, take All 25, or Smart: the least-crowded claims, where your SOL buys the biggest share."
            right={
              <>
                <T v="black" style={{ fontSize: 15, color: blocks ? COLORS.text : COLORS.muted, marginRight: 4 }}>
                  {blocks}
                </T>
                <Chip label="All" on={p.blocks === 'all'} onPress={pickAll} disabled={Boolean(run)} />
                <Chip label="Smart" on={p.blocks === 'smart'} onPress={pickSmart} disabled={Boolean(run)} />
                {selected.length && p.blocks === 'manual' ? <Chip label="Clear" onPress={clearSelection} disabled={Boolean(run)} /> : null}
              </>
            }
          />
          <Row
            icon="🔁"
            label="Rounds"
            info="1 = this round only. More = autopilot repeats the same setup each round (Smart re-picks every round)."
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
          <Row
            icon="🏆"
            label="If it strikes"
            info={`Only the gold claim gets paid. The ORE it mines is split by SOL there, unless it is one of this round's 10 solo claims (★ on the map): then one miner takes it all, with odds equal to their share. A 1-in-500 motherlode pays the whole SKR Motherlode Pool on top, split by SOL on the gold claim, plus 10,000 points. Points: 40 x 25 / claims covered. ${RETURN_INFO}`}
            last
            right={
              <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
                {blocks ? `+${pointsFor(blocks, false, boostFor(staked))} pts · ${Math.round((blocks / BLOCKS) * 100)}% odds · ${soloCount} ★` : '—'}
              </T>
            }
          />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `${fmtSol(perBlock, 5)} SOL × ${blocks} claim${blocks > 1 ? 's' : ''} · if one strikes: ${fmtRange(proRange)} SOL` : undefined}
        onStart={() =>
          void startRun({
            kind: 'pro',
            perRound: per,
            perSpot: perBlock,
            blocks: p.blocks,
            smartN: p.smartN,
            manualMask: maskOf(selected),
            total: p.rounds,
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
