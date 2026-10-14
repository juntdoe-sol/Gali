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
import { Btn, FocusRing, Frame, Kbd, PixelBox, T, U } from './kit';
import { PixIcon } from './PixIcon';
import { useChrome } from './layout';
import { useCave } from '../game/caveStore';

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
  const runs = useCave((s) => s.save.runs);
  const endsAt = useGame(roundEndsAt);
  const soloBits = useGame((s) => soloOf(s, s.roundId));
  const ch = useChrome(insets);
  const top = ch.desktop ? ch.top : insets.top + 104;
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

  let action = picked ? 'PICKED' : 'PICK THIS SPOT';
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
      <Pressable onPress={() => go(-1)} accessibilityRole="button" accessibilityLabel="Back to the island (Esc)" hitSlop={10} style={[styles.back, { top, left: ch.left }]}>
        {(st) => (
          <PixelBox fill={(st as { hovered?: boolean }).hovered ? '#22346a' : 'rgba(8,13,32,0.92)'} hi={COLORS.trim} lo="#04060f" shadow={1} style={styles.backBox}>
            <PixIcon name="back" size={18} />
            <T v="display" style={styles.backText}>
              ISLAND
            </T>
            <Kbd k="ESC" />
            {(st as { focused?: boolean }).focused ? <FocusRing /> : null}
          </PixelBox>
        )}
      </Pressable>
      <PixelBox pointerEvents="none" fill="rgba(8,13,32,0.92)" hi="#2d4282" lo="#04060f" shadow={1} style={[styles.clock, { top, right: ch.right }]}>
        <T v="display" style={styles.clockLabel}>
          {`#${(roundId % 100000).toLocaleString()}`}
        </T>
        <T v="display" style={[styles.clockValue, { color: phase !== 'mining' ? COLORS.gold : secs <= 5 ? COLORS.red : COLORS.text }]}>
          {clock}
        </T>
      </PixelBox>
      <View
        style={[styles.wrap, ch.desktop ? { left: ch.left, right: ch.right, paddingBottom: ch.bottom, alignItems: 'center' } : { paddingBottom: insets.bottom + 10 }]}
        onLayout={(e) => {
          closeupView.bottom = e.nativeEvent.layout.height + 6;
        }}
      >
        <Frame style={[styles.card, ch.desktop && { width: '100%', maxWidth: 560 }]}>
          <View style={styles.head}>
            <Arrow dir={-1} onPress={() => go((focus + BLOCKS - 1) % BLOCKS)} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <T v="display" style={styles.title}>
                {`SPOT ${focus + 1}`}
              </T>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {solo ? <PixIcon name="star" size={16} /> : null}
                <T v="muted" style={styles.subtitle}>
                  {`${solo ? 'Solo · ' : ''}${KIND[c.kind] ?? 'Spot'} · ${c.region}`}
                </T>
              </View>
            </View>
            <Arrow dir={1} onPress={() => go((focus + 1) % BLOCKS)} />
          </View>
          <View style={styles.stats}>
            <Stat label="ON THIS SPOT" value={`${fmtSol(onClaim)} SOL`} color={COLORS.teal} />
            <Stat label="YOURS" value={yours > 0 ? `${fmtSol(yours)} SOL` : '—'} color={yours > 0 ? COLORS.gold : COLORS.muted} />
            <Stat label="OF THE ROUND" value={total > 0 ? `${share}%` : '—'} color={COLORS.text} />
          </View>
          <T v="muted" style={styles.note}>
            {solo
              ? 'Solo spot this round: if it strikes, one wallet on it takes the ORE.'
              : 'If it strikes, everyone on it splits the ORE by the SOL they put in.'}
          </T>
          <Btn kind="ghost" icon={<PixIcon name="cave" size={20} />} label={`Enter the cave · ${runs} ${runs === 1 ? 'run' : 'runs'}`} sub="Walk your miner in, dig for gold, dodge the bats" onPress={() => useCave.getState().show(focus)} />
          <Btn
            label={action}
            sub={sub}
            kbd="SPACE"
            icon={picked && !pending ? <PixIcon name="check" size={20} /> : undefined}
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

function Arrow({ dir, onPress }: { dir: 1 | -1; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={dir < 0 ? 'Previous spot' : 'Next spot'}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox fill={hovered ? '#22346a' : '#0c1734'} hi="#2d4282" lo="#04060f" shadow={pressed ? 0 : 1} style={[styles.arrow, { transform: [{ translateY: pressed ? U : 0 }] }]}>
            <T v="display" style={styles.arrowText}>
              {dir < 0 ? '<' : '>'}
            </T>
            <Kbd k={dir < 0 ? 'A' : 'D'} style={{ position: 'absolute', bottom: -8 }} />
            {focused ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <PixelBox fill="#070d22" hi="#02040c" lo="#1e2c5c" style={styles.stat}>
      <T v="label" style={styles.statLabel}>
        {label}
      </T>
      <T v="display" style={[styles.statValue, { color }]} numberOfLines={1}>
        {value}
      </T>
    </PixelBox>
  );
}

const styles = StyleSheet.create({
  back: { position: 'absolute', left: 12 },
  backBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  backText: { color: COLORS.text, fontSize: 18, lineHeight: 19, letterSpacing: 1 },
  clock: { position: 'absolute', right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  clockLabel: { color: COLORS.muted, fontSize: 15 },
  clockValue: { fontSize: 28, lineHeight: 30 },
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  card: { padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center' },
  arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { color: COLORS.gold, fontSize: 28, lineHeight: 30 },
  title: { color: COLORS.text, fontSize: 30, lineHeight: 32, letterSpacing: 1 },
  subtitle: { fontSize: 13 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, paddingVertical: 8, alignItems: 'center' },
  statLabel: { fontSize: 13, lineHeight: 14, letterSpacing: 1 },
  statValue: { fontSize: 22, lineHeight: 24, marginTop: 2 },
  note: { fontSize: 13, textAlign: 'center' },
});
