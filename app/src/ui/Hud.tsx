import { useEffect, type ReactNode } from 'react';
import { FEATURE_GALI_PROGRAM } from '../config/features';
import { Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CAVE_IN_EVERY, COLORS, LOCK_MS, levelFromXp, MOTHERLODE_ODDS, xpForLevel } from '../game/constants';
import { short } from '../chain/light';
import { isLive, isOnChain, LIVE_LOCK_MS, roundEndsAt, roundSpanMs, useGame, useLevelXp, usePoints, useRoundReward } from '../game/store';
import { fmtSol, practiceMotherlode, practiceOreMotherlode } from '../game/pot';
import { Bar, Frame, IconBtn, PixelBox, T, Tip, U } from './kit';
import { InboxBtn } from './Dm';
import { fx } from '../pixel/fx';
import { useView } from '../pixel/view';
import { useMinersHere } from './World';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';
import { GUTTER, LANDSCAPE_APP, RAIL_W, TOP_H, useLayout } from './layout';
import { HollowBadge } from './Season';
import { LODE_WORD, lodeTier, useLodeGrowth } from '../game/motherlode';
import { refreshMarket, useOreStats } from '../game/oreStats';

/** the landscape app's top bar is narrow: numbers keep their width, labels and the address go */
const TIGHT = LANDSCAPE_APP;

const fmtOre = (v: number) => (v >= 10 ? Math.floor(v).toLocaleString() : v >= 1 ? v.toFixed(2) : v.toFixed(3));

/** The power button that disconnects the wallet: on every screen, not only the island. Nothing when no wallet. */
export function DisconnectBtn() {
  const owner = useGame((s) => s.wallet.owner);
  const disconnect = useGame((s) => s.disconnect);
  if (!owner) return null;
  return (
    <Tip text="Disconnect your wallet" side="bottom" width={170}>
      <IconBtn onPress={() => void disconnect()} label={`Disconnect wallet ${short(owner)}`}>
        <PixIcon name="power" size={20} style={{ opacity: 0.85 }} />
      </IconBtn>
    </Tip>
  );
}

/* ---------------- the wallet chip, shared by both top bars ---------------- */
function WalletChip({ onMenu }: { onMenu: () => void }) {
  const owner = useGame((s) => s.wallet.owner);
  const skr = useGame((s) => s.wallet.skr);
  const ore = useGame((s) => s.wallet.ore);
  const live = useGame(isLive);
  const connect = useGame((s) => s.connect);
  const disconnect = useGame((s) => s.disconnect);
  const { desktop } = useLayout();
  if (!owner)
    return (
      <IconBtn onPress={() => void connect()} label="Connect wallet">
        <View style={[styles.chipRow, { paddingHorizontal: 10 }]}>
          <PixIcon name="wallet" size={20} />
          <T v="display" style={{ fontSize: 17, color: COLORS.skr }}>
            CONNECT
          </T>
        </View>
      </IconBtn>
    );
  return (
    <View style={styles.chipRow}>
      <IconBtn onPress={onMenu} label={`Profile, wallet ${short(owner)}`}>
        <View style={[styles.chipRow, { paddingHorizontal: 10 }]}>
          {live ? (
            <PixelBox fill={COLORS.red} edge="#1c0304" u={1} style={styles.liveTag} >
              <T v="tiny" style={{ color: '#fff', fontSize: 8, lineHeight: 9 }}>
                LIVE
              </T>
            </PixelBox>
          ) : null}
          <PixIcon name={live ? 'ore' : 'skr'} size={18} />
          <T v="display" style={{ fontSize: 18, lineHeight: 20 }}>
            {live ? `${ore.toLocaleString(undefined, { maximumFractionDigits: ore < 1 ? 4 : 2 })}` : `${skr.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </T>
          {TIGHT ? null : (
            <T v="display" style={{ fontSize: 15, color: COLORS.muted }}>
              {live ? 'ORE' : 'SKR'}
            </T>
          )}
          {desktop && !TIGHT ? (
            <T v="bold" style={{ fontSize: 12, color: COLORS.muted, marginLeft: 2 }}>
              {short(owner)}
            </T>
          ) : null}
        </View>
      </IconBtn>
      {/* Connecting is one tap from the header, so leaving should be too. */}
      <Tip text="Disconnect your wallet" side="bottom" width={170}>
        <IconBtn onPress={() => void disconnect()} label={`Disconnect wallet ${short(owner)}`}>
          <PixIcon name="power" size={20} style={{ opacity: 0.85 }} />
        </IconBtn>
      </Tip>
    </View>
  );
}

/* ---------------- the stat strip ---------------- */
function useStats() {
  const xp = useLevelXp();
  const points = usePoints();
  const lvl = levelFromXp(xp);
  const pct = ((xp - xpForLevel(lvl)) / (xpForLevel(lvl + 1) - xpForLevel(lvl))) * 100;
  const sol = useGame((s) => (isOnChain(s) ? s.wallet.sol + s.wallet.sessionSol : s.save.practiceSol));
  const streak = useGame((s) => s.save.winStreak);
  return { points, lvl, pct, sol, streak, xp };
}

function Stat({ icon, color, value, label, tip }: { icon: PixName; color?: string; value: string; label?: string; tip?: string }) {
  const body = (
    <PixelBox fill="rgba(8,13,32,0.86)" hi="rgba(60,86,160,0.5)" lo="#04060f" style={styles.stat}>
      <PixIcon name={icon} size={18} />
      <T v="display" numberOfLines={1} style={{ fontSize: 18, lineHeight: 20, color: color ?? COLORS.text }}>
        {value}
      </T>
      {label && !TIGHT ? <T v="display" style={{ fontSize: 14, color: COLORS.muted }}>{label}</T> : null}
    </PixelBox>
  );
  const grow = TIGHT ? { flexGrow: 0, flexShrink: 0 } : { flexGrow: 1, flexShrink: 1 };
  return tip ? <Tip text={tip} side="bottom" width={200} style={grow}>{body}</Tip> : <View style={grow}>{body}</View>;
}

function LevelStat({ lvl, pct, xp }: { lvl: number; pct: number; xp: number }) {
  return (
    <Tip text={`Level ${lvl}. ${Math.round(pct)}% of the way to level ${lvl + 1} (${xp.toLocaleString()} XP).`} side="bottom" width={210} style={{ flexGrow: 1.4, flexShrink: 1, minWidth: TIGHT ? 58 : undefined }}>
      <PixelBox fill="rgba(8,13,32,0.86)" hi="rgba(60,86,160,0.5)" lo="#04060f" style={styles.stat}>
        <PixelBox fill={COLORS.teal} hi="#d9fbff" lo="#15809a" edge="#021418" style={styles.lvl}>
          <T v="display" style={{ color: '#032026', fontSize: 16, lineHeight: 17 }}>
            {lvl}
          </T>
        </PixelBox>
        <View style={{ flex: 1 }}>
          <Bar pct={pct} colors={['#15809a', COLORS.teal]} height={6} />
        </View>
      </PixelBox>
    </Tip>
  );
}

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const insets = useSafeAreaInsets();
  const { desktop, side, w, h } = useLayout();
  const short = h < 500;
  const { points, lvl, pct, sol, streak, xp } = useStats();

  if (desktop) {
    return (
      <View style={[styles.deskTop, { left: RAIL_W + GUTTER, right: side + GUTTER * 2 }, TIGHT && { gap: 6 }]} pointerEvents="box-none">
        {w >= 1180 ? (
        <PixelBox fill="rgba(8,13,32,0.9)" hi={COLORS.trim} lo="#04060f" shadow={1} style={styles.deskTitle}>
          <PixIcon name="ore" size={24} />
          <View>
            <T v="display" style={{ fontSize: 22, lineHeight: 23, color: COLORS.gold, letterSpacing: 1 }}>
              ORE ISLAND
            </T>
            <T v="label" style={{ fontSize: 12, lineHeight: 13 }}>Live on ORE's board</T>
          </View>
        </PixelBox>
        ) : null}
        <HollowBadge compact={w < 1300} />
        <View style={[styles.chipRow, { flex: 1, maxWidth: 560 }]}>
          {FEATURE_GALI_PROGRAM ? <Stat icon="star" color={COLORS.gold} value={points.toLocaleString()} label="PTS" tip="Points from rounds you mined. They rank you on the season board." /> : null}
          <LevelStat lvl={lvl} pct={pct} xp={xp} />
          <Stat icon="sol" value={sol.toFixed(sol >= 100 ? 1 : 3)} label="SOL" tip="SOL in your wallet." />
          {FEATURE_GALI_PROGRAM && streak >= 2 ? <Stat icon="fire" color={COLORS.red} value={`x${streak}`} tip={`${streak} rounds in a row on the gold spot.`} /> : null}
        </View>
        <InboxBtn />
        <WalletChip onMenu={onMenu} />
      </View>
    );
  }

  return (
    <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <View style={styles.row}>
        <View style={{ alignItems: 'center' }}>
          <Image source={require('../../assets/brand/wordmark.png')} style={{ width: 90, height: 38 }} resizeMode="contain" />
          <T v="display" style={{ fontSize: 13, color: COLORS.gold, letterSpacing: 1.4, marginTop: -4 }}>
            ORE MINING
          </T>
        </View>
        <HollowBadge compact />
        <View style={styles.chipRow}>
          <WalletChip onMenu={onMenu} />
          <InboxBtn />
          <IconBtn onPress={onMenu} label="Open your profile">
            <PixIcon name="user" size={22} />
          </IconBtn>
        </View>
      </View>
      <View style={[styles.row, { marginTop: 8, gap: 6 }, short && { display: 'none' }]}>
        {FEATURE_GALI_PROGRAM ? <Stat icon="star" color={COLORS.gold} value={points.toLocaleString()} label="PTS" /> : null}
        <LevelStat lvl={lvl} pct={pct} xp={xp} />
        <Stat icon="sol" value={sol.toFixed(sol >= 100 ? 1 : 3)} label="SOL" />
        {FEATURE_GALI_PROGRAM && streak >= 2 ? <Stat icon="fire" color={COLORS.red} value={`x${streak}`} /> : null}
      </View>
    </View>
  );
}

/* ---------------- the round card ---------------- */
function BigStat({ icon, value, label, color, sub, subColor }: { icon?: PixName; value: string; label: string; color: string; sub?: string; subColor?: string }) {
  return (
    <View style={styles.bigStat}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon ? <PixIcon name={icon} size={20} /> : null}
        <T v="display" numberOfLines={1} style={{ fontSize: 30, lineHeight: 32, color }}>
          {value}
        </T>
      </View>
      <T v="label" numberOfLines={1} style={{ fontSize: 13, lineHeight: 14 }}>
        {label}
      </T>
      {sub ? (
        <T v="display" numberOfLines={1} style={{ fontSize: 14, lineHeight: 15, color: subColor ?? COLORS.muted }}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}

/** The round's countdown as chunky segments: 20 blocks that go out one by one, red for the last five seconds. */
function Segments({ pct, hot }: { pct: number; hot: boolean }) {
  const n = 20;
  const lit = Math.ceil((Math.max(0, Math.min(100, pct)) / 100) * n);
  return (
    <View style={styles.segs} accessibilityElementsHidden importantForAccessibility="no">
      {Array.from({ length: n }, (_, i) => (
        <View key={i} style={[styles.seg, { backgroundColor: i < lit ? (hot ? COLORS.red : COLORS.gold) : '#0b1330' }]}>
          {i < lit ? <View style={styles.segHi} /> : null}
        </View>
      ))}
    </View>
  );
}

export function RoundCard({ embedded }: { embedded?: boolean }) {
  const insets = useSafeAreaInsets();
  const roundId = useGame((s) => s.roundId);
  const now = useGame((s) => s.now);
  const phase = useGame((s) => s.phase);
  const pending = useGame((s) => s.pending);
  const boost = useGame((s) => s.pending?.boostBps ?? 10_000);
  const onChain = useGame(isOnChain);
  const liveMode = useGame(isLive);
  const liveClock = useGame((s) => s.liveClock);
  const liveClockError = useGame((s) => s.liveClockError);
  const clockPhase = liveMode ? liveClock?.phase : 'mining';
  const endsAt = useGame(roundEndsAt);
  const span = useGame(roundSpanMs);
  const pool = useGame((s) => (onChain ? s.wallet.pool : practiceMotherlode(s.roundId)));
  const orePool = useGame((s) => (onChain ? s.wallet.orePool : practiceOreMotherlode(s.roundId)));
  // a big motherlode turns gold (HUGE also lights the card), and each time it grows the new ORE flashes
  const tier = liveMode ? lodeTier(orePool) : 'normal';
  const grew = useLodeGrowth(liveMode ? orePool : 0);
  const oreUsd = useOreStats((s) => s.market?.oreUsd ?? null);
  useEffect(() => { if (liveMode) void refreshMarket(); }, [liveMode]);
  const pot = useGame((s) => s.pot);
  const run = useGame((s) => s.run);
  const here = useMinersHere();
  const reward = useRoundReward();
  const inside = useView((s) => s.focus >= 0);
  const shortScreen = useLayout().h < 500;
  const live = pot.roundId === roundId;
  const miners = live ? pot.miners : 0;
  const left = Math.max(0, endsAt - now);
  const secs = Math.ceil(left / 1000);
  const cave = !liveMode && roundId % CAVE_IN_EVERY === 0;
  const syncing = liveMode && !liveClock;
  const idle = liveMode && Boolean(liveClock) && phase === 'mining' && clockPhase !== 'mining';
  const locking = phase === 'mining' && !idle && left < (liveMode ? LIVE_LOCK_MS : LOCK_MS);
  const covered = pending ? pending.mask.toString(2).split('1').length - 1 : 0;
  // inside a claim the panel below carries the numbers on a phone; the scene gets the room
  if (inside && !embedded) return null;
  const top = insets.top + (shortScreen ? 56 : 104);
  const timeColor = liveClockError ? COLORS.red : phase !== 'mining' || idle || syncing ? COLORS.gold : secs <= 5 || locking ? COLORS.red : COLORS.text;
  const timeValue = syncing
    ? liveClockError
      ? 'OFFLINE'
      : 'SYNC'
    : idle
      ? clockPhase === 'waiting'
        ? 'START'
        : 'NEXT'
      : phase === 'mining'
        ? `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
        : phase === 'settling'
          ? pending?.onChain
            ? 'SETTLING'
            : 'MINING'
          : 'STRIKE!';
  const timeLabel = syncing ? (liveClockError ? 'BOARD OFFLINE' : 'SYNCING') : idle ? (clockPhase === 'waiting' ? 'FIRST DEPLOY' : 'ROUND SOON') : locking ? 'LOCKED' : 'TIME LEFT';

  return (
    <Frame style={embedded ? styles.roundEmbedded : [styles.round, { top }]} glow={cave ? COLORS.red : tier === 'huge' ? COLORS.gold : undefined}>
      {embedded ? null : (
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          onLayout={(e) => {
            fx.viewTop = top + e.nativeEvent.layout.height + 10;
          }}
        />
      )}
      <View style={styles.roundHead}>
        <View style={styles.chipRow}>
          {liveMode ? (
            <PixelBox fill={COLORS.red} edge="#1c0304" u={1} style={styles.liveTag}>
              <T v="tiny" style={{ color: '#fff', fontSize: 8, lineHeight: 9 }}>
                LIVE
              </T>
            </PixelBox>
          ) : null}
          <T v="display" style={{ fontSize: 17, lineHeight: 18, color: cave ? COLORS.red : COLORS.text }} numberOfLines={1}>
            ROUND {liveMode ? (liveClock ? `#${(roundId % 100000).toLocaleString()}` : '...') : `#${(roundId % 100000).toLocaleString()}`}
          </T>
        </View>
        <T v="display" style={{ fontSize: 15, lineHeight: 16, color: cave ? COLORS.red : COLORS.muted }} numberOfLines={1}>
          {liveMode ? 'ORE MAINNET' : cave ? 'CAVE-IN ROUND' : `CAVE-IN IN ${CAVE_IN_EVERY - (roundId % CAVE_IN_EVERY)}`}
        </T>
      </View>
      <View style={styles.stats}>
        <BigStat icon="sol" value={live ? fmtSol(pot.total, pot.total < 1 ? 4 : 2) : '0'} label="DEPLOYED" color={COLORS.text} />
        <View style={styles.divider} />
        <BigStat
          icon="ore"
          value={orePool.toFixed(orePool < 100 ? 1 : 0)}
          label={tier === 'normal' ? 'MOTHERLODE' : `${LODE_WORD[tier]} MOTHERLODE`}
          color={grew ? '#ffffff' : tier === 'normal' ? COLORS.teal : COLORS.gold}
          sub={
            liveMode
              ? grew
                ? `+${grew.toFixed(grew < 1 ? 2 : 1)} ORE`
                : oreUsd
                  ? `≈ $${Math.round(orePool * oreUsd).toLocaleString()}`
                  : undefined
              : `+${pool >= 1000 ? `${(pool / 1000).toFixed(1)}K` : Math.floor(pool)} SKR POOL`
          }
          subColor={grew ? COLORS.green : COLORS.gold}
        />
        <View style={styles.divider} />
        <BigStat icon="clock" value={timeValue} label={timeLabel} color={timeColor} />
      </View>
      <Segments pct={phase === 'mining' && !idle ? (left / span) * 100 : 0} hot={secs <= 5 || locking} />
      <View style={[styles.row, { marginTop: 6 }]}>
        <View style={styles.chipRow}>
          <PixIcon name="pick" size={16} />
          <T v="bold" style={{ fontSize: 13, color: COLORS.muted }} numberOfLines={1}>
            {miners} miner{miners === 1 ? '' : 's'}
          </T>
          <PixIcon name="users" size={16} style={{ marginLeft: 6 }} />
          <T v="bold" style={{ fontSize: 13, color: COLORS.muted }} numberOfLines={1}>
            {here} here
          </T>
        </View>
        <T v="bold" style={{ fontSize: 13, color: pending ? COLORS.gold : COLORS.muted, flexShrink: 1, textAlign: 'right' }} numberOfLines={1}>
          {syncing
            ? liveClockError
              ? 'Retrying board read'
              : 'Reading ORE board'
            : pending
              ? `You: ${covered} spot${covered > 1 ? 's' : ''} · ${fmtSol(pending.total)} SOL`
              : `${fmtOre(reward)} ORE · motherlode 1/${MOTHERLODE_ODDS}`}
        </T>
      </View>
      {run && run.total > 1 ? (
        <T v="bold" style={{ fontSize: 13, textAlign: 'center', marginTop: 4, color: COLORS.teal }} numberOfLines={1}>
          Autopilot {run.total - run.left}/{run.total}
          {FEATURE_GALI_PROGRAM && pending && boost > 10_000 ? ` · ${boost / 10_000}x points` : ''}
        </T>
      ) : FEATURE_GALI_PROGRAM && pending && boost > 10_000 ? (
        <T v="bold" style={{ fontSize: 13, textAlign: 'center', marginTop: 4, color: COLORS.skr }}>
          {boost / 10_000}x points
        </T>
      ) : null}
    </Frame>
  );
}

/* ---------------- toasts ---------------- */
const TOAST_ICON: Record<string, PixName> = { good: 'check', bad: 'warn', gold: 'star', info: 'info' };
const TOAST_EDGE: Record<string, string> = { good: COLORS.green, bad: COLORS.red, gold: COLORS.gold, info: '#3a54a0' };

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  const insets = useSafeAreaInsets();
  const { desktop, side } = useLayout();
  return (
    <View
      style={[styles.toasts, desktop ? { top: TOP_H + 26, left: RAIL_W + GUTTER, right: side + GUTTER * 2 } : { top: insets.top + 190 }]}
      pointerEvents="none"
      accessibilityLiveRegion="polite"
    >
      {toasts.map((t) => (
        <PixelBox key={t.id} fill="rgba(10,16,38,0.95)" hi={TOAST_EDGE[t.tone] + 'aa'} lo="#04060f" edge="#04060f" shadow={2} style={[styles.toast, desktop && { maxWidth: 520 }]}>
          <View style={[styles.toastEdge, { backgroundColor: TOAST_EDGE[t.tone] }]} />
          <PixIcon name={TOAST_ICON[t.tone] ?? 'info'} size={18} />
          <T v="bold" style={{ fontSize: 14, flexShrink: 1 }}>
            {t.text}
          </T>
        </PixelBox>
      ))}
    </View>
  );
}

/** A small framed note for anything that wants a heading and a line (used by side panels). */
export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <T v="label">{title}</T>
        {right}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12 },
  deskTop: { position: 'absolute', top: GUTTER, height: TOP_H - GUTTER, flexDirection: 'row', alignItems: 'center', gap: 16 },
  deskTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 44 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stats: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 8 },
  bigStat: { flex: 1, alignItems: 'center', gap: 2 },
  divider: { width: U, alignSelf: 'stretch', marginVertical: 2, backgroundColor: '#22356f' },
  liveTag: { paddingHorizontal: 4, paddingVertical: 2 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: TIGHT ? 4 : 6, paddingHorizontal: TIGHT ? 7 : 10, height: 36 },
  lvl: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  round: { position: 'absolute', left: 12, right: 12, paddingHorizontal: 14, paddingVertical: 10 },
  roundEmbedded: { paddingHorizontal: 14, paddingVertical: 12 },
  roundHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  segs: { flexDirection: 'row', gap: U, padding: U, backgroundColor: '#04060f' },
  seg: { flex: 1, height: 10 },
  segHi: { position: 'absolute', left: 0, right: 0, top: 0, height: U, backgroundColor: '#ffffff66' },
  toasts: { position: 'absolute', left: 24, right: 24, alignItems: 'center', gap: 8, zIndex: 50 },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 14, paddingVertical: 10 },
  toastEdge: { position: 'absolute', left: U, top: U, bottom: U, width: U * 2 },
});
