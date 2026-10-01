import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAVE_IN_EVERY, COLORS, LOCK_MS, levelFromXp, MOTHERLODE_ODDS, ROUND_SECS, xpForLevel } from '../game/constants';
import { chainReady, short } from '../chain/light';
import { roundEnd, useGame, useLevelXp, usePoints, useRoundReward } from '../game/store';
const fmtOre = (v: number) => (v >= 10 ? Math.floor(v).toLocaleString() : v >= 1 ? v.toFixed(2) : v.toFixed(3));
import { fmtSol, practiceMotherlode, practiceOreMotherlode } from '../game/pot';
import { Bar, F, Frame, T } from './kit';
import { TAB_ICON } from './TabBar';
import { fx } from '../pixel/fx';
import { useView } from '../pixel/view';
import { useMinersHere } from './World';

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const insets = useSafeAreaInsets();
  const owner = useGame((s) => s.wallet.owner);
  const skr = useGame((s) => s.wallet.skr);
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
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
            <>
              <Pressable onPress={onMenu} style={styles.chip}>
                <View style={[styles.dot, { backgroundColor: COLORS.skr }]} />
                <T v="bold" style={{ fontSize: 13 }}>
                  {skr.toLocaleString(undefined, { maximumFractionDigits: 0 })} SKR
                </T>
                <T v="muted" style={{ fontSize: 11 }}>
                  {short(owner)}
                </T>
              </Pressable>
              {/* Connecting is one tap from the header, so leaving should be too,
                  rather than buried three screens deep in the Me tab. */}
              <Pressable
                onPress={() => void disconnect()}
                style={styles.unplug}
                accessibilityRole="button"
                accessibilityLabel={`Disconnect wallet ${short(owner)}`}
              >
                <T v="display" style={{ fontSize: 16, color: COLORS.muted }}>
                  ⏻
                </T>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => void connect()} style={[styles.chip, { borderColor: COLORS.skr }]}>
              <T v="bold" style={{ fontSize: 13, color: COLORS.skr }}>
                Connect wallet
              </T>
            </Pressable>
          )}
          <Pressable onPress={onMenu} style={styles.menu} accessibilityRole="button" accessibilityLabel="Open your profile">
            <Image source={TAB_ICON.me} style={{ width: 22, height: 22, tintColor: COLORS.gold }} />
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

const compact = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}K` : Math.floor(v).toLocaleString());

function BigStat({ icon, value, label, color }: { icon?: ReactNode; value: string; label: string; color: string }) {
  return (
    <View style={styles.bigStat}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {icon}
        <T v="display" numberOfLines={1} style={{ fontSize: 26, lineHeight: 30, color }}>
          {value}
        </T>
      </View>
      <T v="bold" numberOfLines={1} style={{ fontSize: 10, letterSpacing: 1, color: COLORS.muted }}>
        {label}
      </T>
    </View>
  );
}

/** Both jackpots in one cell: ORE's motherlode, and Gali's SKR pool that pays on the same hit. */
function MotherlodeStat({ ore, skr }: { ore: number; skr: number }) {
  return (
    <View style={styles.bigStat}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <T v="black" style={{ fontSize: 18, color: COLORS.teal }}>
          ◆
        </T>
        <T v="display" numberOfLines={1} style={{ fontSize: 26, lineHeight: 30, color: COLORS.teal }}>
          {ore.toFixed(ore < 100 ? 1 : 0)}
        </T>
        <T v="bold" style={{ fontSize: 11, color: COLORS.teal }}>
          ORE
        </T>
      </View>
      <T v="bold" numberOfLines={1} style={{ fontSize: 10, letterSpacing: 1, color: COLORS.muted }}>
        MOTHERLODE
      </T>
      <T v="bold" numberOfLines={1} style={{ fontSize: 10, lineHeight: 12, color: COLORS.gold }}>
        +{skr >= 1000 ? `${(skr / 1000).toFixed(1)}K` : Math.floor(skr)} SKR pool
      </T>
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
  const onChain = useGame((s) => Boolean(s.wallet.owner && chainReady));
  const pool = useGame((s) => (onChain ? s.wallet.pool : practiceMotherlode(s.roundId)));
  const orePool = useGame((s) => (onChain ? s.wallet.orePool : practiceOreMotherlode(s.roundId)));
  const pot = useGame((s) => s.pot);
  const run = useGame((s) => s.run);
  const here = useMinersHere();
  const reward = useRoundReward();
  const inside = useView((s) => s.focus >= 0);
  const live = pot.roundId === roundId;
  const miners = live ? pot.miners : 0;
  const left = Math.max(0, roundEnd(roundId) - now);
  const secs = Math.ceil(left / 1000);
  const cave = roundId % CAVE_IN_EVERY === 0;
  const locking = phase === 'mining' && left < LOCK_MS;
  const covered = pending ? pending.mask.toString(2).split('1').length - 1 : 0;
  // inside a claim the panel below carries the numbers; the scene gets the room
  if (inside) return null;
  return (
    <Frame style={[styles.round, { top: insets.top + 104 }]} glow={cave ? COLORS.red : undefined} radius={12}>
      <View
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onLayout={(e) => {
          fx.viewTop = insets.top + 104 + e.nativeEvent.layout.height + 10;
        }}
      />
      <View style={styles.stats}>
        <BigStat
          icon={<T v="black" style={{ fontSize: 18, color: COLORS.sol }}>◎</T>}
          value={live ? fmtSol(pot.total, pot.total < 1 ? 4 : 2) : '0'}
          label="DEPLOYED"
          color={COLORS.text}
        />
        <View style={styles.divider} />
        <MotherlodeStat ore={orePool} skr={pool} />
        <View style={styles.divider} />
        <BigStat
          value={
            phase === 'mining'
              ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
              : phase === 'settling'
                ? pending?.onChain
                  ? 'SETTLING'
                  : 'MINING'
                : 'STRIKE!'
          }
          label={locking ? 'LOCKED' : 'TIME'}
          color={phase !== 'mining' ? COLORS.gold : secs <= 5 || locking ? COLORS.red : COLORS.text}
        />
      </View>
      <Bar pct={phase === 'mining' ? (left / (ROUND_SECS * 1000)) * 100 : 0} height={4} />
      <View style={[styles.row, { marginTop: 4 }]}>
        <T v="bold" style={{ fontSize: 11, color: cave ? COLORS.red : COLORS.muted }} numberOfLines={1}>
          #{(roundId % 100000).toLocaleString()} · {cave ? '⚠ CAVE-IN' : `Cave-in in ${CAVE_IN_EVERY - (roundId % CAVE_IN_EVERY)}`}
        </T>
        <T v="bold" style={{ fontSize: 11, color: COLORS.muted }} numberOfLines={1}>
          {pending ? `You: ${covered} spot${covered > 1 ? 's' : ''} · ${fmtSol(pending.total)} SOL` : `${fmtOre(reward)} ORE to mine · motherlode 1/${MOTHERLODE_ODDS}`}
        </T>
      </View>
      <T v="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 1, color: run ? COLORS.teal : pending && boost > 10_000 ? COLORS.skr : COLORS.muted }} numberOfLines={1}>
        {run ? `Autopilot ${run.total - run.left}/${run.total} · ` : ''}⛏ {miners} miner{miners === 1 ? '' : 's'} this round · 👥 {here} on the map
        {pending && boost > 10_000 ? ` · ${boost / 10_000}x points` : ''}
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
  stats: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  bigStat: { flex: 1, alignItems: 'center', gap: 1 },
  divider: { width: 1, alignSelf: 'stretch', marginVertical: 4, backgroundColor: COLORS.line },
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
  unplug: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: '#070d20cc',
  },
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
