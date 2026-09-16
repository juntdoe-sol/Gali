import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { boostFor, COLORS, LOCK_MS, pointsFor } from '../game/constants';
import { roundEnd, useGame } from '../game/store';
import { Btn, T } from './kit';

const SHAKE_G = 2.1;

export function Dock() {
  const insets = useSafeAreaInsets();
  const selected = useGame((s) => s.selected);
  const phase = useGame((s) => s.phase);
  const pending = useGame((s) => s.pending);
  const busy = useGame((s) => s.wallet.busy);
  const owner = useGame((s) => s.wallet.owner);
  const staked = useGame((s) => s.wallet.player?.stakedSkr ?? 0);
  const locked = useGame((s) => s.phase !== 'mining' || roundEnd(s.roundId) - s.now < LOCK_MS);
  const { selectRandom, selectAll, clearSelection, dig, doEmote } = useGame.getState();

  // shake the phone to dig
  useEffect(() => {
    let last = 0;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener(({ x, y, z }) => {
      const g = Math.sqrt(x * x + y * y + z * z);
      if (g > SHAKE_G && Date.now() - last > 2500) {
        last = Date.now();
        void useGame.getState().dig('shake');
      }
    });
    return () => sub.remove();
  }, []);

  const n = selected.length;
  const payout = n ? pointsFor(n, false, boostFor(staked)) : 0;
  const label = busy
    ? busy
    : phase !== 'mining'
      ? 'Revealing…'
      : pending
        ? 'Dug! Wait for the strike'
        : locked
          ? 'Locked'
          : n
            ? `DIG ${n} BLOCK${n > 1 ? 'S' : ''}`
            : 'Tap blocks or shake';
  const sub = !busy && !pending && n && !locked ? `Free dig · win pays ${payout} pts · ${Math.round((n / 25) * 100)}% odds` : owner ? 'On-chain · devnet' : 'Practice mode · connect wallet to play on-chain';

  const canPick = phase === 'mining' && !pending && !busy;
  return (
    <View style={[styles.dock, { paddingBottom: insets.bottom + 10 }]}>
      <View style={styles.row}>
        <Btn small label="🎲 1" onPress={() => selectRandom(1)} disabled={!canPick} />
        <Btn small label="🎲 5" onPress={() => selectRandom(5)} disabled={!canPick} />
        <Btn small label="All" onPress={selectAll} disabled={!canPick} />
        <Btn small label="Clear" onPress={clearSelection} disabled={!n || !canPick} />
        <Btn small label="💃" onPress={doEmote} />
      </View>
      <Btn kind="gold" label={label} sub={sub} onPress={() => void dig('tap')} disabled={!n || locked || Boolean(pending) || Boolean(busy)} style={{ minHeight: 64, marginTop: 10 }} />
      <T v="muted" style={{ textAlign: 'center', marginTop: 6, fontSize: 11 }}>
        Fewer blocks = bigger payout. Bonk moles for XP.
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingTop: 12,
    backgroundColor: 'rgba(37,27,53,0.96)',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  row: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
});
