import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chainReady } from '../chain/client';
import { BLOCKS, boostFor, COLORS, pointsFor, ROUND_REWARD_SKR } from '../game/constants';
import { watchMotion } from '../game/motion';
import { fmtSol, maskOf, MIN_SOL_PER_BLOCK, OPTIMAL_ROUNDS, optimalPerRound, smartPick } from '../game/pot';
import { useGame, type DockTab, type Preset } from '../game/store';
import { Btn, F, T } from './kit';

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
    <View style={[styles.dock, { paddingBottom: insets.bottom + 10 }]}>
      <View style={styles.seg}>
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => {
              if (t.id === tab) setFolded(!compact);
              else {
                setTab(t.id);
                setFolded(null);
              }
            }}
            style={[styles.segBtn, tab === t.id && styles.segOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.id }}
          >
            <T v="black" style={{ fontSize: 12, letterSpacing: 2, color: tab === t.id ? COLORS.text : COLORS.muted }}>
              {t.label}
              {run?.kind === t.id ? ' ●' : ''}
              {t.id === tab ? (compact ? ' ▴' : ' ▾') : ''}
            </T>
          </Pressable>
        ))}
      </View>
      {tab === 'lite' ? <LitePanel compact={compact} /> : <ProPanel compact={compact} />}
    </View>
  );
}

/* ---------------- shared bits ---------------- */
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

function Chip({ label, on, onPress, disabled }: { label: string; on?: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn, disabled && { opacity: 0.4 }]}>
      <T v="bold" style={{ fontSize: 12, color: on ? COLORS.gold : COLORS.muted }}>
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

function AmountBox({ value, onChange, hint }: { value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <View style={styles.amount}>
      <View style={styles.token}>
        <View style={styles.solMark}>
          <T v="black" style={{ fontSize: 12, color: '#0d0814' }}>
            ◎
          </T>
        </View>
        <T v="black" style={{ fontSize: 16 }}>
          SOL
        </T>
      </View>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(',', '.').replace(/[^0-9.]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={COLORS.line}
        style={styles.input}
        accessibilityLabel={hint}
      />
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

/* ---------------- LITE: pick a budget, we spread it ---------------- */
function LitePanel({ compact }: { compact: boolean }) {
  const { balance } = useBalance();
  const startRun = useGame((s) => s.startRun);
  const [amount, setAmount] = useState('');
  const [perRound, setPerRound] = useState<string | null>(null); // null = Optimal
  const total = Number(amount) || 0;
  const per = perRound === null ? optimalPerRound(total) : Number(perRound) || 0;
  const rounds = total > 0 && per > 0 ? Math.floor(total / per + 1e-9) : 0;
  const perBlockOk = per / BLOCKS >= MIN_SOL_PER_BLOCK;
  const enough = total <= balance + 1e-9;
  const ready = total > 0 && rounds > 0 && perBlockOk && enough;
  const label = !total
    ? 'ENTER AMOUNT'
    : !enough
      ? 'NOT ENOUGH SOL'
      : !perBlockOk
        ? `MIN ${MIN_SOL_PER_BLOCK * BLOCKS} SOL A ROUND`
        : `DEPLOY ${rounds} ROUND${rounds > 1 ? 'S' : ''}`;
  return (
    <>
      {compact ? null : (
        <>
          <BalanceRow onHalf={() => setAmount(trim((balance - RESERVE) / 2))} onAll={() => setAmount(trim(balance - RESERVE))} />
          <AmountBox value={amount} onChange={setAmount} hint="Total SOL to deploy" />
          <Row
            icon="🪙"
            label="Per round"
            info={`How much SOL goes in each round, spread across all 25 blocks so you share every strike and the ${ROUND_REWARD_SKR} SKR it mines. Optimal splits your amount over ${OPTIMAL_ROUNDS} rounds.`}
            right={
              <>
                <Chip label="Optimal" on={perRound === null} onPress={() => setPerRound(null)} />
                <TextInput
                  value={perRound === null ? (per ? fmtSol(per) : '0') : perRound}
                  onChangeText={(t) => setPerRound(t.replace(',', '.').replace(/[^0-9.]/g, ''))}
                  keyboardType="decimal-pad"
                  style={styles.small}
                  accessibilityLabel="SOL per round"
                />
              </>
            }
          />
          <Row
            icon="🔁"
            label="Rounds"
            info="Autopilot deploys once a round until your amount is used. Keep the app open. You can stop any time."
            last
            right={
              <T v="black" style={{ fontSize: 15, color: rounds ? COLORS.text : COLORS.muted }}>
                {rounds || '—'}
              </T>
            }
          />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `${fmtSol(per)} SOL a round on all 25 blocks · winners split the pot + ${ROUND_REWARD_SKR} SKR` : undefined}
        onStart={() => void startRun({ kind: 'lite', perRound: per, blocks: 'all', smartN: BLOCKS, manualMask: 0, total: rounds })}
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
  const per = Number(p.amount) || 0;

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
  const perBlock = blocks ? per / blocks : 0;
  const need = per * p.rounds;
  const enough = need <= balance + 1e-9;
  const ready = blocks > 0 && per > 0 && perBlock >= MIN_SOL_PER_BLOCK && enough && !pending;
  const label = !blocks
    ? 'NO SLOTS SELECTED'
    : !per
      ? 'ENTER AMOUNT'
      : perBlock < MIN_SOL_PER_BLOCK
        ? `MIN ${MIN_SOL_PER_BLOCK} SOL PER BLOCK`
        : !enough
          ? 'NOT ENOUGH SOL'
          : pending
            ? 'WAIT FOR THIS ROUND'
            : `DEPLOY ${fmtSol(per)} SOL${p.rounds > 1 ? ` × ${p.rounds}` : ''}`;
  const onWin = selected.length ? Math.min(...selected.map((i) => pot.perBlock[i] ?? 0)) : 0;
  const bestShare = perBlock > 0 ? perBlock / (onWin + perBlock) : 0;

  return (
    <>
      {compact ? null : (
        <>
          <Row icon="🔖" label="Presets" info="Four saved setups. Changes save to the selected preset." right={null} />
          <View style={[styles.lineRight, { justifyContent: 'space-between', marginTop: 2 }]}>
            {[0, 1, 2, 3].map((i) => (
              <Chip key={i} label={`Preset ${i + 1}`} on={i === idx} onPress={() => choosePreset(i)} disabled={Boolean(run)} />
            ))}
          </View>
          <BalanceRow
            onHalf={() => editPreset({ amount: trim((balance - RESERVE) / 2 / Math.max(1, p.rounds)) })}
            onAll={() => editPreset({ amount: trim((balance - RESERVE) / Math.max(1, p.rounds)) })}
          />
          <AmountBox value={p.amount} onChange={(v) => editPreset({ amount: v })} hint="SOL per round" />
          <Row
            icon="▦"
            label="Blocks"
            info="Tap tiles on the mine, take All 25, or Smart: the least-crowded blocks, where your SOL buys the biggest share."
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
            info="Winning blocks pay your share of 90% of the SOL pot and of the 25 SKR mined, plus points: 40 x 25 / blocks covered. A 1-in-625 motherlode adds 5,000 SKR and 10,000 points."
            last
            right={
              <T v="black" style={{ fontSize: 13, color: COLORS.gold }}>
                {blocks ? `+${pointsFor(blocks, false, boostFor(staked))} pts · ${Math.round((blocks / BLOCKS) * 100)}% odds` : '—'}
              </T>
            }
          />
        </>
      )}
      <RunButton
        ready={ready}
        label={label}
        sub={ready ? `${fmtSol(perBlock, 5)} SOL a block · up to ${Math.round(bestShare * 100)}% of a strike right now` : undefined}
        onStart={() =>
          void startRun({
            kind: 'pro',
            perRound: per,
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

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: 'rgba(37,27,53,0.97)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  seg: { flexDirection: 'row', backgroundColor: '#00000055', borderRadius: 14, padding: 3, marginBottom: 10 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 11 },
  segOn: { backgroundColor: COLORS.card2, borderWidth: 1, borderColor: COLORS.line },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderColor: COLORS.line, minHeight: 42 },
  lineLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineRight: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  info: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: COLORS.muted, alignItems: 'center', justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, backgroundColor: '#00000033' },
  chipOn: { borderColor: COLORS.gold, backgroundColor: '#ffc83d22' },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 56,
    marginTop: 8,
    backgroundColor: '#00000044',
  },
  token: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, borderRightWidth: 1, borderColor: COLORS.line },
  solMark: { width: 22, height: 22, borderRadius: 6, backgroundColor: COLORS.sol, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, textAlign: 'right', color: COLORS.text, fontFamily: F.display, fontSize: 24, paddingVertical: 0 },
  small: {
    width: 72,
    textAlign: 'right',
    color: COLORS.text,
    fontFamily: F.bold,
    fontSize: 14,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
  },
  tag: { borderWidth: 1, borderColor: COLORS.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: COLORS.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: COLORS.gold, borderColor: COLORS.gold },
});
