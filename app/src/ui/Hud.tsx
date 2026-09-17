import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAVE_IN_EVERY, COLORS, ROUND_REWARD_SKR, LOCK_MS, levelFromXp, xpForLevel } from '../game/constants';
import { chainReady } from '../chain/client';
import { roundEnd, useGame, useLevelXp, usePoints } from '../game/store';
import { short } from '../chain/client';
import { fmtSol } from '../game/pot';
import { Bar, F, Frame, Pill, T } from './kit';

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
            <Pressable onPress={() => void connect()} style={[styles.chip, { borderColor: COLORS.skr }]}>
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
            <T v="display" style={{ color: '#062a33', fontSize: 12, transform: [{ rotate: '-45deg' }] }}>
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
      <T v="display" style={{ fontSize: 13 }}>
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
    <Frame style={[styles.round, { top: insets.top + 104 }]} glow={cave ? COLORS.red : undefined} radius={12}>
      <View style={styles.row}>
        {phase === 'mining' ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1 }}>
            <T v="display" style={{ fontSize: 26, lineHeight: 30, color: secs <= 5 ? COLORS.red : COLORS.gold }}>
              {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
            </T>
            <T v="muted" style={{ fontSize: 12, color: locking ? COLORS.red : COLORS.muted }}>
              {locking ? 'LOCKED' : pending ? `${covered} block${covered > 1 ? 's' : ''} in` : 'to deploy'}
            </T>
          </View>
        ) : (
          <T v="display" style={{ fontSize: 20, lineHeight: 30, color: COLORS.gold, flexShrink: 1 }} numberOfLines={1}>
            {phase === 'settling' ? (pending?.onChain ? 'SETTLING…' : 'MINING…') : 'STRIKE!'}
          </T>
        )}
        {cave ? (
          <Pill text={`#${(roundId % 100000).toLocaleString()} · ⚠ CAVE-IN`} color={COLORS.red} />
        ) : (
          <Pill text={`#${(roundId % 100000).toLocaleString()} · Cave-in in ${CAVE_IN_EVERY - (roundId % CAVE_IN_EVERY)}`} />
        )}
      </View>
      <Bar pct={phase === 'mining' ? (left / 60000) * 100 : 0} height={5} />
      <View style={[styles.row, { marginTop: 4 }]}>
        <T v="bold" style={{ fontSize: 11, color: COLORS.sol }} numberOfLines={1}>
          ◎ {pot.roundId === roundId ? fmtSol(pot.total) : '0.0'} SOL · {pot.roundId === roundId ? pot.miners : 0} miners
        </T>
        <T v="bold" style={{ fontSize: 11, color: COLORS.teal }} numberOfLines={1}>
          💎 {pool > 0 ? `${pool.toLocaleString()} SKR` : 'Motherlode'} · 1/625
        </T>
      </View>
      <T v="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 1, color: run ? COLORS.teal : pending && boost > 10_000 ? COLORS.skr : COLORS.muted }} numberOfLines={1}>
        {run ? `Autopilot ${run.total - run.left}/${run.total}` : pending ? `You: ${fmtSol(pending.total)} SOL` : `${ROUND_REWARD_SKR} SKR to mine`}
        {pending && boost > 10_000 ? ` · ${boost / 10_000}x SKR boost` : ''}
      </T>
    </Frame>
  );
}

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.toasts, { top: insets.top + 190 }]} pointerEvents="none">
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
    backgroundColor: '#0a1636ee',
    borderColor: COLORS.trim,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 38,
  },
  dot: { width: 9, height: 9, borderRadius: 2, transform: [{ rotate: '45deg' }] },
  menu: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#132a5aee',
    borderColor: COLORS.trim,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0a1636e6',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    height: 32,
  },
  lvl: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: COLORS.teal,
    borderWidth: 1,
    borderColor: '#d9fbff',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
    marginHorizontal: 2,
  },
  round: {
    position: 'absolute',
    left: 12,
    right: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    gap: 4,
  },
  toasts: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 6 },
  toast: { backgroundColor: '#0f1c3ff2', borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, fontFamily: F.bold },
});
