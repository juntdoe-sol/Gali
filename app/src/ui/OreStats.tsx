/**
 * Desktop ORE Island: a small panel over the left of the map with your ORE and all of Gali's.
 * Folds to its title bar; the choice is remembered on this browser.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { COLORS } from '../game/constants';
import { useLobby } from '../game/lobby';
import { refreshOreStats, useOreStats } from '../game/oreStats';
import { fmtOreAmt } from '../game/pot';
import { useGame } from '../game/store';
import { Frame, T, Tip } from './kit';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, useLayout } from './layout';
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

export function OreStatsPanel() {
  const { desktop } = useLayout();
  const where = useLobby((s) => s.where);
  const owner = useGame((s) => s.wallet.owner);
  const { me, gali, status } = useOreStats();
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
    <View style={styles.wrap} pointerEvents="box-none">
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
            <T v="label" style={styles.section}>
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
            <T v="label" style={styles.section}>
              ALL GALI MINERS
            </T>
            {gali ? (
              <Row
                label={`All-time ORE (${gali.miners.toLocaleString()} miners)`}
                value={fmtOreAmt(gali.ore)}
                tip="Every Gali miner's all-time ORE added up, read from each wallet's ORE miner account when they play."
              />
            ) : (
              <T v="muted" style={styles.note}>
                Loading…
              </T>
            )}
          </>
        )}
      </Frame>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: RAIL_W + GUTTER, top: TOP_H + GUTTER, width: 262 },
  card: { paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 18, color: COLORS.gold, letterSpacing: 1 },
  fold: { fontSize: 18, color: COLORS.muted, width: 16, textAlign: 'center' },
  section: { marginTop: 6, fontSize: 11 },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, paddingVertical: 1 },
  label: { fontSize: 12, flexShrink: 1 },
  value: { fontSize: 18, color: COLORS.text },
  note: { fontSize: 12 },
});
