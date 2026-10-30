/**
 * Desktop ORE Island: a small panel over the left of the map with your ORE and all of Gali's.
 * Folds to its title bar; the choice is remembered on this browser.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { fmtUsd, profitUsd, refreshOreStats, useOreStats } from '../game/oreStats';
import { fmtOreAmt } from '../game/pot';
import { useGame } from '../game/store';
import { Frame, T, Tip } from './kit';
import { LANDSCAPE_APP, useLayout } from './layout';
import { PixIcon } from './PixIcon';

const FOLD_KEY = 'gali-ore-stats-folded';
const readFold = () => {
  try {
    return globalThis.localStorage?.getItem(FOLD_KEY) === '1';
  } catch {
    return false;
  }
};

function Row({ label, value, tip, color }: { label: string; value: string; tip?: string; color?: string }) {
  const line = (
    <View style={styles.row}>
      <T v="muted" style={styles.label} numberOfLines={1}>
        {label}
      </T>
      <T v="display" style={[styles.value, color ? { color } : null]} numberOfLines={1}>
        {value}
      </T>
    </View>
  );
  return tip ? (
    <Tip text={tip} side="right" width={230}>
      {line}
    </Tip>
  ) : (
    line
  );
}

/** Desktop ORE Island only: sits at the top of the mining column on the right (see Side.tsx). */
export function OreStatsPanel() {
  const { desktop } = useLayout();
  const where = useLobby((s) => s.where);
  const owner = useGame((s) => s.wallet.owner);
  const { me, gali, status, market } = useOreStats();
  const myProfit = me ? profitUsd(me.lifetime, me.deployedSol, me.returnedSol, market) : null;
  const galiProfit = market ? profitUsd(market.ore, market.deployedSol, market.returnedSol, market) : null;
  const usdOf = (sol: number) => (market?.solUsd && market.solUsd > 0 ? fmtUsd(sol * market.solUsd).replace(/^\+/, '') : '—');
  const solShort = (sol: number) => sol.toLocaleString(undefined, { maximumFractionDigits: sol < 10 ? 3 : sol < 1000 ? 1 : 0 });
  const SPENT_TIP = 'What mining really cost: all the SOL put on ORE’s board minus all the SOL ORE gave back, at today’s SOL price. The same SOL redeployed round after round only counts what was lost.';
  const PROFIT_TIP = 'ORE mined at today’s ORE price, plus the SOL ORE gave back, minus all the SOL put on the board, at today’s SOL price. ORE’s 10% claim fee and refined ORE are not counted. Prices from Jupiter, every 5 minutes.';
  const [folded, setFolded] = useState(readFold);
  const show = desktop && !LANDSCAPE_APP && where === 'island';

  useEffect(() => {
    if (!show) return;
    void refreshOreStats();
    const id = setInterval(() => void refreshOreStats(), 60_000);
    return () => clearInterval(id);
  }, [show, owner]);

  if (!show) return null;
  const fold = () => {
    setFolded((f) => {
      try {
        globalThis.localStorage?.setItem(FOLD_KEY, f ? '0' : '1');
      } catch {
        /* private window */
      }
      return !f;
    });
  };
  return (
    <View pointerEvents="box-none">
      <Frame tone="dark" gems={false} glow={COLORS.gold} style={styles.card}>
        <Pressable onPress={fold} accessibilityRole="button" accessibilityLabel={folded ? 'Show ORE stats' : 'Hide ORE stats'} style={styles.head}>
          <PixIcon name="ore" size={18} />
          <T v="display" style={styles.title}>
            ORE STATS
          </T>
          <T v="bold" style={styles.fold}>
            {folded ? '+' : '–'}
          </T>
        </Pressable>
        {folded ? null : (
          <>
            <View style={[styles.block, { borderColor: COLORS.gold }]}>
            <T v="label" style={[styles.section, { color: COLORS.gold }]}>
              YOU
            </T>
            {!owner ? (
              <T v="muted" style={styles.note}>
                Connect a wallet to see your ORE.
              </T>
            ) : !me ? (
              <T v="muted" style={styles.note}>
                {status === 'error' ? 'Could not read your ORE. Trying again in a minute.' : 'Reading your ORE…'}
              </T>
            ) : (
              <>
                <Row label="All-time ORE mined" value={fmtOreAmt(me.lifetime)} tip="Every ORE this wallet has mined on ORE's board, claimed or not. ORE's own lifetime counter." />
                <Row
                  label="All-time profit"
                  value={myProfit === null ? '—' : fmtUsd(myProfit)}
                  color={myProfit === null ? undefined : myProfit >= 0 ? COLORS.green : COLORS.red}
                  tip={myProfit === null ? 'Waiting for ORE and SOL prices.' : PROFIT_TIP}
                />
                <Row
                  label={`SOL spent (${solShort(me.deployedSol - me.returnedSol)})`}
                  value={usdOf(me.deployedSol - me.returnedSol)}
                  tip={`${(me.deployedSol - me.returnedSol).toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL: ${me.deployedSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} put in, ${me.returnedSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} back. ${SPENT_TIP}`}
                />
                <Row label="Unrefined" value={fmtOreAmt(me.unrefined)} color={COLORS.gold} tip="Mined and not claimed yet. Claiming it costs ORE's 10% fee. Holding it earns refined ORE." />
                <Row label="Refined, ready" value={fmtOreAmt(me.refined)} color={COLORS.teal} tip="Earned from other miners' 10% fees while you held unrefined ORE. Claims with no fee." />
                <Row
                  label={me.gainHours >= 24 ? 'Refined, last 24h' : `Refined, last ${me.gainHours}h`}
                  value={me.gain === null ? '—' : `+${fmtOreAmt(me.gain)}`}
                  color={COLORS.green}
                  tip={me.gain === null ? 'The 24 hour gain starts once the server has saved ORE’s refining rate.' : 'About how much refined ORE your unrefined ORE earned, from ORE’s refining rate over this time.'}
                />
              </>
            )}
            </View>
            <View style={[styles.block, { borderColor: COLORS.teal }]}>
            <T v="label" style={[styles.section, { color: COLORS.teal }]}>
              ALL GALI MINERS
            </T>
            {gali ? (
              <Row
                label={`All-time ORE (${gali.miners.toLocaleString()} miners)`}
                value={fmtOreAmt(gali.ore)}
                tip="Every Gali miner's all-time ORE added up, read from each wallet's ORE miner account when they play."
              />
            ) : null}
            {galiProfit !== null ? (
              <Row
                label="All-time profit"
                value={fmtUsd(galiProfit)}
                color={galiProfit >= 0 ? COLORS.green : COLORS.red}
                tip={`Every Gali wallet together (${market!.miners.toLocaleString()} with ORE accounts). ${PROFIT_TIP}`}
              />
            ) : null}
            {market && market.deployedSol > 0 ? (
              <Row
                label={`SOL spent (${solShort(market.deployedSol - market.returnedSol)})`}
                value={usdOf(market.deployedSol - market.returnedSol)}
                tip={`Every Gali wallet together: ${market.deployedSol.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL put in, ${market.returnedSol.toLocaleString(undefined, { maximumFractionDigits: 2 })} back. ${SPENT_TIP}`}
              />
            ) : null}
            {gali ? null : (
              <T v="muted" style={styles.note}>
                Loading…
              </T>
            )}
            </View>
            {market?.oreUsd && market.solUsd ? (
              <View style={styles.prices}>
                <T v="muted" style={styles.priceLabel}>
                  ORE <T v="display" style={styles.price}>${market.oreUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</T>
                </T>
                <T v="muted" style={styles.priceLabel}>
                  SOL <T v="display" style={styles.price}>${market.solUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</T>
                </T>
              </View>
            ) : null}
          </>
        )}
      </Frame>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, color: COLORS.gold, letterSpacing: 1 },
  fold: { fontSize: 18, color: COLORS.muted, width: 16, textAlign: 'center' },
  section: { fontSize: 11, marginBottom: 2 },
  block: { marginTop: 8, paddingHorizontal: 8, paddingVertical: 6, borderWidth: 1, borderLeftWidth: 3, backgroundColor: 'rgba(4,6,15,0.55)' },
  prices: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: 2 },
  priceLabel: { fontSize: 11, letterSpacing: 1 },
  price: { fontSize: 16, color: COLORS.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingVertical: 1 },
  label: { fontFamily: 'Jersey15_400Regular', fontSize: 15, lineHeight: 17, letterSpacing: 0.4, flexShrink: 1, fontVariant: ['tabular-nums'] },
  value: { fontSize: 18, color: COLORS.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12 },
});
