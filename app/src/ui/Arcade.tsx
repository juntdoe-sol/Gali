/**
 * The three lobby games, opened from the TRAVEL menu. One shared round clock for every player, an ORE table and an
 * SKR table for each game. The rules and payouts live on the house (rpc-backend/functions/games.mjs); this screen
 * shows the round, takes a stake and shows the result.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS } from '../game/constants';
import { CLIENT_CUTOFF_MS, CRASH_TARGETS, GAME_META, fmtAmt, useArcade, type GameId, type RoundResult, type TokenId } from '../game/arcade';
import { useGame } from '../game/store';
import { Btn, T } from './kit';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

const GAME_ICON: Record<GameId, PixName> = { tunnel: 'tunnel', pot: 'pot', crash: 'cart' };
const GLASS = 'rgba(10,16,40,0.72)';
const GLASS_IN = 'rgba(255,255,255,0.07)';
const EDGE = 'rgba(255,255,255,0.16)';

function useClock(ms: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      tick((n) => n + 1);
      useArcade.getState().tick();
    }, ms);
    return () => clearInterval(id);
  }, [ms]);
  return Date.now() + useArcade.getState().offsetMs;
}

/** sha256(secret) must equal the commitment the house showed before the round. */
function useVerified(r: RoundResult | undefined) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    setOk(null);
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (!r || !subtle || !/^[0-9a-f]{64}$/.test(r.secret)) return;
    const bytes = Uint8Array.from(r.secret.match(/../g)!.map((h) => parseInt(h, 16)));
    subtle
      .digest('SHA-256', bytes)
      .then((d) => setOk([...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('') === r.commit))
      .catch(() => undefined);
  }, [r]);
  return ok;
}

export function Arcade() {
  const insets = useSafeAreaInsets();
  const game = useArcade((s) => s.game);
  const token = useArcade((s) => s.token);
  const cfg = useArcade((s) => s.cfg);
  const cfgError = useArcade((s) => s.cfgError);
  const commit = useArcade((s) => s.commit);
  const choice = useArcade((s) => s.choice);
  const chip = useArcade((s) => s.chip);
  const busy = useArcade((s) => s.busy);
  const note = useArcade((s) => s.note);
  const stakes = useArcade((s) => s.stakes);
  const results = useArcade((s) => s.results);
  const balance = useArcade((s) => s.balance);
  const connected = useGame((s) => Boolean(s.wallet.owner));
  const [how, setHow] = useState(false);
  const now = useClock(500);
  useEffect(() => {
    useArcade.getState().tick();
  }, [game, token]);
  const last = useMemo(() => results.find((r) => r.game === game && r.token === token), [results, game, token]);
  const verified = useVerified(last);
  if (!game) return null;

  const meta = GAME_META[game];
  const tb = cfg?.tokens[token];
  const roundMs = cfg?.roundMs ?? 40_000;
  const round = Math.floor(now / roundMs);
  const into = now - round * roundMs;
  const open = into < CLIENT_CUTOFF_MS;
  const left = Math.max(0, Math.ceil(((open ? CLIENT_CUTOFF_MS : roundMs) - into) / 1000));
  const TK = token.toUpperCase();
  const mineNow = stakes.filter((s) => s.game === game && s.token === token && s.round === round);
  const waiting = stakes.filter((s) => s.game === game && s.token === token && s.round < round);
  const amount = tb?.chips[chip] ?? '';
  const have = balance[token];
  const stakeLabel = busy ? 'WAITING FOR WALLET…' : !connected ? 'CONNECT A WALLET' : open ? `STAKE ${amount} ${TK}` : `NEXT ROUND IN ${left}s`;
  const pick = game === 'pot' ? 0 : choice[game];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => useArcade.getState().open(null)} accessibilityLabel="Close game" />
      <View style={[styles.panel, { borderColor: meta.color, shadowColor: meta.color }]}>
        <View style={styles.head}>
          <View style={[styles.badge, { borderColor: meta.color }]}>
            <PixIcon name={GAME_ICON[game]} size={32} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="display" style={{ fontSize: 22, color: meta.color, letterSpacing: 1 }} numberOfLines={1}>
              {meta.name}
            </T>
            <T v="muted" style={{ fontSize: 12 }} numberOfLines={1}>
              {meta.line}
            </T>
          </View>
          <Pressable onPress={() => useArcade.getState().open(null)} style={styles.close} accessibilityRole="button" accessibilityLabel="Close game">
            <T v="black" style={{ fontSize: 15, color: COLORS.text }}>
              ✕
            </T>
          </Pressable>
        </View>

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          <View style={styles.row}>
            {(['ore', 'skr'] as TokenId[]).map((t) => (
              <Pressable key={t} onPress={() => useArcade.getState().setToken(t)} style={[styles.tab, token === t && { backgroundColor: meta.color, borderColor: meta.color }]} accessibilityRole="tab">
                <T v="black" style={{ fontSize: 14, color: token === t ? '#10162c' : COLORS.text }}>
                  {t.toUpperCase()} TABLE
                </T>
                <T v="bold" style={{ fontSize: 10, color: token === t ? '#10162c' : COLORS.muted }}>
                  {balance[t] === null ? '' : `you hold ${fmtAmt(balance[t] ?? 0)}`}
                </T>
              </Pressable>
            ))}
          </View>

          {!cfg ? (
            <View style={styles.card}>
              <T v="bold" style={{ textAlign: 'center' }}>
                {cfgError ?? 'Opening the tables…'}
              </T>
              {cfgError ? <Btn kind="ghost" label="TRY AGAIN" onPress={() => useArcade.getState().open(game)} /> : null}
            </View>
          ) : !tb?.ready ? (
            <View style={styles.card}>
              <T v="bold" style={{ textAlign: 'center' }}>
                The {TK} table is not open yet.
              </T>
              <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                {tb?.reason ?? 'Check back soon.'}
              </T>
            </View>
          ) : (
            <>
              <View style={[styles.card, { borderColor: open ? meta.color : COLORS.line }]}>
                <View style={styles.rowBetween}>
                  <T v="black" style={{ fontSize: 13, color: open ? COLORS.green : COLORS.muted }}>
                    {open ? 'STAKES OPEN' : 'STAKES CLOSED'}
                  </T>
                  <T v="display" style={{ fontSize: 28, color: open ? meta.color : COLORS.muted }}>
                    {left}s
                  </T>
                </View>
                <View style={styles.segs}>
                  {Array.from({ length: 20 }, (_, i) => {
                    const on = (i + 1) / 20 <= into / roundMs + 0.0001;
                    const closedPart = (i + 0.5) / 20 >= CLIENT_CUTOFF_MS / roundMs;
                    return <View key={i} style={[styles.seg, { backgroundColor: on ? (closedPart ? '#ff6b6b' : meta.color) : 'rgba(255,255,255,0.12)' }]} />;
                  })}
                </View>
                <T v="muted" style={{ fontSize: 10 }} numberOfLines={1}>
                  Round {round} · house commitment {commit && commit.round === round ? `${commit.hash.slice(0, 10)}…${commit.hash.slice(-6)}` : '…'}
                </T>
              </View>

              {game === 'tunnel' ? (
                <View style={styles.row}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Pressable key={i} onPress={() => useArcade.getState().setChoice(i)} style={({ pressed }) => [styles.tunnel, pick === i && { borderColor: meta.color, backgroundColor: 'rgba(255,154,61,0.24)', shadowColor: meta.color, shadowOpacity: 0.9, shadowRadius: 8 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel={`Tunnel ${i + 1}`}>
                      <PixIcon name="tunnel" size={32} />
                      <T v="display" style={{ fontSize: 16, color: pick === i ? meta.color : COLORS.muted }}>
                        {i + 1}
                      </T>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {game === 'crash' ? (
                <View style={styles.card}>
                  <T v="bold" style={{ fontSize: 12, textAlign: 'center' }}>
                    Cash out at
                  </T>
                  <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'center' }]}>
                    {CRASH_TARGETS.map((c) => (
                      <Pressable key={c} onPress={() => useArcade.getState().setChoice(c)} style={({ pressed }) => [styles.target, pick === c && { borderColor: meta.color, backgroundColor: 'rgba(61,224,200,0.22)', shadowColor: meta.color, shadowOpacity: 0.9, shadowRadius: 8 }, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button">
                        <T v="display" style={{ fontSize: 20, color: pick === c ? meta.color : COLORS.text }}>
                          {(c / 10).toFixed(1)}x
                        </T>
                        <T v="bold" style={{ fontSize: 9, color: COLORS.muted }}>
                          {Math.min(95, 950 / c).toFixed(0)}% to hit
                        </T>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}
              {game === 'pot' ? (
                <View style={styles.card}>
                  <PixIcon name="pot" size={48} style={{ alignSelf: 'center' }} />
                  <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                    The more you stake, the more tickets you hold. One ticket takes the pot.
                  </T>
                </View>
              ) : null}

              <View style={styles.row}>
                {tb.chips.map((c, i) => (
                  <Pressable key={c} onPress={() => useArcade.getState().setChip(i)} style={({ pressed }) => [styles.chip, chip === i && { backgroundColor: meta.color, borderColor: '#ffffff', shadowColor: meta.color, shadowOpacity: 0.9, shadowRadius: 10 }, pressed && { transform: [{ scale: 0.94 }] }]} accessibilityRole="button">
                    <T v="display" style={{ fontSize: 20, color: chip === i ? '#10162c' : COLORS.text }}>
                      {c}
                    </T>
                    <T v="bold" style={{ fontSize: 9, color: chip === i ? '#10162c' : COLORS.muted }}>
                      {TK}
                    </T>
                  </Pressable>
                ))}
              </View>
              <Btn kind="gold" label={stakeLabel} disabled={busy || !connected || !open || (have !== null && have < Number(amount))} onPress={() => useArcade.getState().stake()} />
              {note ? (
                <T v="muted" style={{ fontSize: 12, textAlign: 'center' }}>
                  {note}
                </T>
              ) : null}
              {have !== null && have < Number(amount) ? (
                <T v="bold" style={{ fontSize: 11, textAlign: 'center', color: COLORS.red }}>
                  You hold {fmtAmt(have)} {TK}. Pick a smaller stake.
                </T>
              ) : null}
              {mineNow.length || waiting.length ? (
                <View style={styles.card}>
                  {mineNow.map((s) => (
                    <T key={s.sig} v="bold" style={{ fontSize: 12 }}>
                      This round: {s.amount} {TK}
                      {game === 'tunnel' ? ` in tunnel ${s.choice + 1}` : game === 'crash' ? ` cashing out at ${(s.choice / 10).toFixed(1)}x` : ''}
                    </T>
                  ))}
                  {waiting.length ? (
                    <T v="muted" style={{ fontSize: 11 }}>
                      {waiting.length} earlier stake{waiting.length > 1 ? 's' : ''} settling. Winners are paid by the house automatically.
                    </T>
                  ) : null}
                </View>
              ) : null}

              {last ? <ResultCard r={last} verified={verified} color={meta.color} /> : null}
              <Pressable onPress={() => setHow((v) => !v)} accessibilityRole="button">
                <T v="bold" style={{ fontSize: 12, color: COLORS.teal, textAlign: 'center' }}>
                  {how ? 'Hide how it works' : 'How it works and how to check it'}
                </T>
              </Pressable>
              {how ? (
                <View style={styles.card}>
                  <T v="muted" style={{ fontSize: 12 }}>
                    {meta.how}
                  </T>
                  <T v="muted" style={{ fontSize: 12 }}>
                    Stakes go to the Gali house wallet and winners are paid from it automatically. Before every round the house shows a hash of its secret. After the round it shows the secret, so the draw can be checked: the hash of the secret must equal the commitment, and the winner comes from the secret plus every stake in the round. Limit {tb.capUnits && tb.decimals !== undefined ? fmtAmt(Number(tb.capUnits) / 10 ** tb.decimals) : ''} {TK} per wallet per round. 18+ only. Only play with what you can afford to lose.
                  </T>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

function ResultCard({ r, verified, color }: { r: RoundResult; verified: boolean | null; color: string }) {
  const TK = r.token.toUpperCase();
  const m = r.mine;
  const line = r.outcome.void
    ? `Refunded: ${r.outcome.void}`
    : r.game === 'tunnel'
      ? `Tunnel ${(r.outcome.collapsed ?? 0) + 1} caved in`
      : r.game === 'crash'
        ? `The cart crashed at ${(r.outcome.crash ?? 1).toFixed(2)}x`
        : '';
  return (
    <View style={[styles.card, { borderColor: m && m.net > 0 ? COLORS.gold : COLORS.line }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {m && m.net > 0 ? <PixIcon name="trophy" size={16} /> : null}
        <T v="black" style={{ fontSize: 13, color }}>
          LAST ROUND #{r.round}
        </T>
      </View>
      <T v="bold" style={{ fontSize: 14 }}>
        {r.game === 'pot' && r.outcome.winner ? `${r.outcome.winner.slice(0, 4)}…${r.outcome.winner.slice(-4)} won the pot of ${fmtAmt(Number(r.outcome.pot) / 10 ** (r.decimals ?? 0))} ${TK}` : line}
      </T>
      {r.game === 'tunnel' && r.outcome.pool ? (
        <View style={styles.row}>
          {r.outcome.pool.map((p, i) => (
            <View key={i} style={[styles.mini, i === r.outcome.collapsed && { borderColor: COLORS.red }]}>
              <T v="black" style={{ fontSize: 11, color: i === r.outcome.collapsed ? COLORS.red : COLORS.muted }}>
                {i + 1}
              </T>
              <T v="bold" style={{ fontSize: 9, color: COLORS.muted }}>
                {r.bets.filter((b) => b.choice === i).length}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      <T v="muted" style={{ fontSize: 11 }}>
        {r.bets.length} stake{r.bets.length === 1 ? '' : 's'} from {new Set(r.bets.map((b) => b.who)).size} miner{new Set(r.bets.map((b) => b.who)).size === 1 ? '' : 's'}
      </T>
      {m ? (
        <T v="black" style={{ fontSize: 16, color: m.net > 0 ? COLORS.gold : m.net < 0 ? COLORS.red : COLORS.text }}>
          {m.net > 0 ? `You won +${fmtAmt(m.net)} ${TK}` : m.net < 0 ? `You lost ${fmtAmt(-m.net)} ${TK}` : 'Your stake came back'}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {verified === true ? <PixIcon name="check" size={16} /> : null}
        <T v="muted" style={{ fontSize: 10, flex: 1 }} numberOfLines={2}>
          {verified === true ? 'Checked: the secret matches the commitment.' : verified === false ? 'The secret does not match the commitment.' : `Commitment ${r.commit.slice(0, 12)}…`}
        </T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,6,18,0.38)', zIndex: 60, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  panel: { width: '100%', maxWidth: 430, maxHeight: '100%', padding: 14, gap: 10, borderRadius: 22, borderWidth: 2, backgroundColor: GLASS, shadowOpacity: 0.55, shadowRadius: 22, shadowOffset: { width: 0, height: 0 }, elevation: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 48, height: 48, borderRadius: 14, borderWidth: 2, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center' },
  close: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: EDGE, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tab: { flex: 1, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: EDGE, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 16, borderWidth: 1.5, borderColor: EDGE, backgroundColor: GLASS_IN, padding: 12, gap: 6 },
  segs: { flexDirection: 'row', gap: 3 },
  seg: { flex: 1, height: 9, borderRadius: 3 },
  tunnel: { flex: 1, height: 84, borderRadius: 14, borderWidth: 1.5, borderColor: EDGE, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center', gap: 0, borderTopLeftRadius: 32, borderTopRightRadius: 32, shadowOffset: { width: 0, height: 0 } },
  target: { width: '31%', height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: EDGE, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 } },
  chip: { flex: 1, height: 60, borderRadius: 30, borderWidth: 2, borderColor: EDGE, backgroundColor: GLASS_IN, alignItems: 'center', justifyContent: 'center', shadowOffset: { width: 0, height: 0 } },
  mini: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1.5, borderColor: EDGE, alignItems: 'center', justifyContent: 'center' },
});
