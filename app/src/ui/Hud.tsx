import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAVE_IN_EVERY, COLORS, ROUND_REWARD_SKR, LOCK_MS, levelFromXp, xpForLevel } from '../game/constants';
import { chainReady } from '../chain/client';
import { roundEnd, useGame, useLevelXp, usePoints } from '../game/store';
import { short } from '../chain/client';
import { fmtSol } from '../game/pot';
import { Bar, F, Pill, T } from './kit';

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const insets = useSafeAreaInsets();
  const owner = useGame((s) => s.wallet.owner);
  const skr = useGame((s) => s.wallet.skr);
  const connect = useGame((s) => s.connect);
  const xp = useLevelXp();
  const points = usePoints();
  const lvl = levelFromXp(xp);
  const pct = ((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100;
  const sol = useGame((s) => (s.wallet.owner && chainReady ? s.wallet.sol + s.wallet.sessionSol : s.save.practiceSol));
  const streak = useGame((s) => s.save.winStreak);

  return (
    <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.row}>
        <Image source={require('../../assets/brand/wordmark.png')} style={styles.logo} resizeMode="contain" />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {owner ? (
            <Pressable onPress={onMenu} style={styles.chip}>
              <View style={[styles.dot, { backgroundColor: COLORS.skr }]} />
              <T v="bold" style={{ fontSize: 13 }}>
                {skr.toLocaleString(undefined, { maximumFractionDigits: 0 })} SKR
              </T>
              <T v="muted" style={{ fontSize: 11 }}>
                {short(owner)}
              </T>
            </Pressable>
          ) : (
            <Pressable onPress={connect} style={[styles.chip, { borderColor: COLORS.skr }]}>
              <T v="bold" style={{ fontSize: 13, color: COLORS.skr }}>
                Connect wallet
              </T>
            </Pressable>
          )}
          <Pressable onPress={onMenu} style={styles.menu} accessibilityLabel="Open menu">
            <T v="display" style={{ fontSize: 20 }}>
              ☰
            </T>
          </Pressable>
        </View>
      </View>
      <View style={[styles.row, { marginTop: 8 }]}>
        <Stat icon="◆" color={COLORS.gold} value={points.toLocaleString()} label="pts" />
        <View style={[styles.stat, { flex: 1.3 }]}>
          <View style={styles.lvl}>
            <T v="black" style={{ color: '#0d3a33', fontSize: 13 }}>
              {lvl}
            </T>
          </View>
          <View style={{ flex: 1 }}>
            <Bar pct={pct} colors={[COLORS.teal, '#8ff5e6']} />
          </View>
        </View>
        <Stat icon="◎" color={COLORS.sol} value={sol.toFixed(sol >= 100 ? 1 : 3)} label="SOL" />
        {streak >= 2 ? <Stat icon="🔥" color={COLORS.red} value={`x${streak}`} label="" /> : null}
      </View>
    </View>
  );
}

function Stat({ icon, color, value, label }: { icon: string; color: string; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <T v="black" style={{ color, fontSize: 14 }}>
        {icon}
      </T>
      <T v="black" style={{ fontSize: 14 }}>
        {value}
      </T>
      {label ? <T v="muted">{label}</T> : null}
    </View>
  );
}

export function RoundCard() {
  const insets = useSafeAreaInsets();
  const roundId = useGame((s) => s.roundId);
  const now = useGame((s) => s.now);
  const phase = useGame((s) => s.phase);
  const pending = useGame((s) => s.pending);
  const boost = useGame((s) => s.pending?.boostBps ?? 10_000);
  const pool = useGame((s) => s.wallet.pool);
  const pot = useGame((s) => s.pot);
  const run = useGame((s) => s.run);
  const left = Math.max(0, roundEnd(roundId) - now);
  const secs = Math.ceil(left / 1000);
  const cave = roundId % CAVE_IN_EVERY === 0;
  const locking = phase === 'mining' && left < LOCK_MS;
  const covered = pending ? pending.mask.toString(2).split('1').length - 1 : 0;
  return (
    <View style={[styles.round, { top: insets.top + 104 }, cave && { borderColor: COLORS.red }]}>
      <View style={[styles.row, { marginBottom: 2 }]}>
        <T v="muted">Round #{(roundId % 100000).toLocaleString()}</T>
        {cave ? <Pill text="⚠ CAVE-IN" color={COLORS.red} /> : <Pill text={`Cave-in in ${CAVE_IN_EVERY - (roundId % CAVE_IN_EVERY)}`} />}
      </View>
      {phase === 'mining' ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 8 }}>
          <T v="display" style={{ fontSize: 40, color: secs <= 5 ? COLORS.red : COLORS.text }}>
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
          </T>
          <T v="muted" style={{ color: locking ? COLORS.red : COLORS.muted }}>
            {locking ? 'LOCKED' : pending ? `${covered} block${covered > 1 ? 's' : ''} in` : 'to deploy'}
          </T>
        </View>
      ) : (
        <T v="display" style={{ fontSize: 34, color: COLORS.gold, textAlign: 'center' }}>
          {phase === 'settling' ? (pending?.onChain ? 'SETTLING ON-CHAIN…' : 'MINING…') : 'STRIKE!'}
        </T>
      )}
      <Bar pct={phase === 'mining' ? (left / 60000) * 100 : 0} />
      <View style={[styles.row, { marginTop: 5 }]}>
        <T v="bold" style={{ fontSize: 11, color: COLORS.sol }}>
          ◎ Pot {pot.roundId === roundId ? fmtSol(pot.total) : '0.0'} SOL · {pot.roundId === roundId ? pot.miners : 0} miners
        </T>
        <T v="muted" style={{ fontSize: 11, color: run ? COLORS.teal : COLORS.muted }}>
          {run ? `Autopilot ${run.total - run.left}/${run.total}` : pending ? `You: ${fmtSol(pending.total)} SOL` : `${ROUND_REWARD_SKR} SKR to mine`}
        </T>
      </View>
      <View style={[styles.row, { marginTop: 2 }]}>
        <T v="bold" style={{ fontSize: 11, color: COLORS.teal }}>
          💎 Motherlode {pool > 0 ? `${pool.toLocaleString()} SKR` : 'SKR pool'}
        </T>
        <T v="muted" style={{ fontSize: 11 }}>
          1 in 625 · 5,000 SKR
        </T>
      </View>
      {pending && boost > 10_000 ? (
        <T v="bold" style={{ color: COLORS.skr, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
          SKR boost {boost / 10_000}x active
        </T>
      ) : null}
    </View>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.toasts, { top: insets.top + 210 }]} pointerEvents="none">
      {toasts.map((t) => (
        <View
          key={t.id}
          style={[
            styles.toast,
            { borderColor: t.tone === 'good' ? COLORS.green : t.tone === 'bad' ? COLORS.red : t.tone === 'gold' ? COLORS.gold : COLORS.line },
          ]}
        >
          <T v="bold" style={{ fontSize: 13, textAlign: 'center' }}>
            {t.text}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  logo: { width: 104, height: 46 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderRadius: 999,
    paddingHorizontal: 12,
    height: 38,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  menu: { width: 38, height: 38, borderRadius: 12, backgroundColor: COLORS.card2, borderColor: COLORS.line, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.card,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderRadius: 999,
    paddingHorizontal: 10,
    height: 34,
  },
  lvl: { width: 22, height: 22, borderRadius: 7, backgroundColor: COLORS.teal, alignItems: 'center', justifyContent: 'center' },
  round: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(45,34,64,0.94)',
    borderColor: COLORS.line,
    borderWidth: 2,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toasts: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 6 },
  toast: { backgroundColor: COLORS.card2, borderWidth: 2, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, fontFamily: F.bold },
});
