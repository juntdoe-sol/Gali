/**
 * The panel under a claim you've dived into: what's on it, whether you're in,
 * and a way to pick it, flick to the next one, or climb back out.
 */
import { useEffect } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BLOCKS, COLORS } from '../game/constants';
import { fmtSol } from '../game/pot';
import { roundEndsAt, soloOf, useGame } from '../game/store';
import { CLAIMS } from '../engine/island';
import { closeupView } from '../pixel/PixelMine';
import { useView } from '../pixel/view';
import { Btn, Frame, T } from './kit';

const KIND: Record<string, string> = { cave: 'Cave mouth', scree: 'Scree slope', dig: 'Dig pit', gold: 'Gold stream' };

export function ClaimPanel() {
  const focus = useView((s) => s.focus);
  const go = useView((s) => s.go);
  const insets = useSafeAreaInsets();
  const selected = useGame((s) => s.selected);
  const phase = useGame((s) => s.phase);
  const pending = useGame((s) => s.pending);
  const run = useGame((s) => s.run);
  const roundId = useGame((s) => s.roundId);
  const pot = useGame((s) => s.pot);
  const winning = useGame((s) => s.winning);
  const now = useGame((s) => s.now);
  const endsAt = useGame(roundEndsAt);
  const soloBits = useGame((s) => soloOf(s, s.roundId));
  const top = insets.top + 104;
  closeupView.top = top + 52;

  useEffect(() => {
    if (focus < 0) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      go(-1);
      return true;
    });
    return () => sub.remove();
  }, [focus, go]);

  if (focus < 0) return null;
  const c = CLAIMS[focus];
  const onClaim = pot.roundId === roundId ? pot.perBlock[focus] ?? 0 : 0;
  const total = pot.roundId === roundId ? pot.perBlock.reduce((a, b) => a + b, 0) : 0;
  const yours = pending && pending.mask & (1 << focus) ? pending.perBlock : 0;
  const picked = selected.includes(focus);
  const solo = Boolean(soloBits & (1 << focus));
  const share = total > 0 && onClaim > 0 ? Math.round((onClaim / total) * 100) : 0;
  const locked = phase !== 'mining' || Boolean(pending) || Boolean(run);
  const struck = phase === 'reveal' && winning === focus;
  const secs = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const clock = phase === 'mining' && endsAt === 0 ? 'READY' : phase === 'mining' ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : phase === 'settling' ? 'MINING' : 'STRIKE!';

  let action = picked ? 'PICKED  ✓' : 'PICK THIS SPOT';
  let sub = picked ? 'Tap to unpick. Deploy from the island.' : 'Adds it to your picks for this round';
  if (pending) {
    action = yours > 0 ? 'YOU ARE MINING HERE' : 'NOT IN THIS ROUND';
    sub = 'Your SOL is in for this round';
  } else if (phase !== 'mining') {
    action = struck ? 'STRUCK GOLD HERE' : 'ROUND SETTLING';
    sub = 'Picks open again in a moment';
  } else if (run) {
    action = 'AUTOPILOT RUNNING';
    sub = 'Stop autopilot to pick by hand';
  }

  return (
    <>
      <Pressable
        onPress={() => go(-1)}
        accessibilityRole="button"
        accessibilityLabel="Back to the island"
        hitSlop={10}
        style={[styles.back, { top }]}
      >
        <T v="black" style={styles.backText}>
          ‹ ISLAND
        </T>
      </Pressable>
      <View pointerEvents="none" style={[styles.clock, { top }]}>
        <T v="bold" style={styles.clockLabel}>
          {`#${(roundId % 100000).toLocaleString()}`}
        </T>
        <T v="display" style={[styles.clockValue, { color: phase !== 'mining' ? COLORS.gold : secs <= 5 ? COLORS.red : COLORS.text }]}>
          {clock}
        </T>
      </View>
      <View
        style={[styles.wrap, { paddingBottom: insets.bottom + 10 }]}
        onLayout={(e) => {
          closeupView.bottom = e.nativeEvent.layout.height + 6;
        }}
      >
        <Frame style={styles.card} radius={14}>
          <View style={styles.head}>
            <Pressable onPress={() => go((focus + BLOCKS - 1) % BLOCKS)} hitSlop={10} style={styles.arrow} accessibilityRole="button" accessibilityLabel="Previous spot">
              <T v="display" style={styles.arrowText}>
                ‹
              </T>
            </Pressable>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <T v="display" style={styles.title}>
                {`SPOT ${focus + 1}${solo ? '  ★' : ''}`}
              </T>
              <T v="muted" style={styles.subtitle}>
                {`${KIND[c.kind] ?? 'Spot'} · ${c.region}`}
              </T>
            </View>
            <Pressable onPress={() => go((focus + 1) % BLOCKS)} hitSlop={10} style={styles.arrow} accessibilityRole="button" accessibilityLabel="Next spot">
              <T v="display" style={styles.arrowText}>
                ›
              </T>
            </Pressable>
          </View>
          <View style={styles.stats}>
            <Stat label="ON THIS SPOT" value={`${fmtSol(onClaim)} SOL`} color={COLORS.teal} />
            <Stat label="YOURS" value={yours > 0 ? `${fmtSol(yours)} SOL` : '—'} color={yours > 0 ? COLORS.gold : COLORS.muted} />
            <Stat label="OF THE ROUND" value={total > 0 ? `${share}%` : '—'} color={COLORS.text} />
          </View>
          <T v="muted" style={styles.note}>
            {solo
              ? '★ Solo spot this round: if it strikes, one wallet on it takes the ORE.'
              : 'If it strikes, everyone on it splits the ORE by the SOL they put in.'}
          </T>
          <Btn
            label={action}
            sub={sub}
            kind={picked || pending ? 'plain' : 'gold'}
            disabled={locked && !struck}
            onPress={() => {
              if (!locked) useGame.getState().toggleBlock(focus);
            }}
          />
        </Frame>
      </View>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.stat}>
      <T v="label" style={styles.statLabel}>
        {label}
      </T>
      <T v="display" style={[styles.statValue, { color }]} numberOfLines={1}>
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    position: 'absolute',
    left: 12,
    backgroundColor: '#070d20e6',
    borderColor: COLORS.trim,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backText: { color: COLORS.text, fontSize: 13, letterSpacing: 1 },
  clock: {
    position: 'absolute',
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#070d20e6',
    borderColor: COLORS.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  clockLabel: { color: COLORS.muted, fontSize: 11 },
  clockValue: { fontSize: 24, lineHeight: 28 },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  card: { padding: 12, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#0c1734', borderWidth: 1, borderColor: COLORS.line },
  arrowText: { color: COLORS.gold, fontSize: 30, lineHeight: 32 },
  title: { color: COLORS.text, fontSize: 26, letterSpacing: 1 },
  subtitle: { fontSize: 12 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, backgroundColor: '#0c1734', borderRadius: 10, borderWidth: 1, borderColor: COLORS.line, paddingVertical: 6, alignItems: 'center' },
  statLabel: { fontSize: 9, letterSpacing: 1 },
  statValue: { fontSize: 19, marginTop: 1 },
  note: { fontSize: 11, textAlign: 'center' },
});
