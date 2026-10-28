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
import { Btn, FocusRing, Frame, IconBtn, PixelBox, T, U } from './kit';
import { useLayout } from './layout';
import type { ReactNode } from 'react';
import { PixIcon } from './PixIcon';
import type { PixName } from './pixIcons';

const GAME_ICON: Record<GameId, PixName> = { tunnel: 'tunnel', pot: 'pot', crash: 'cart' };
/** A selectable pixel tile: the tables, tunnels, cash-out targets and stake chips are all one of these. */
function Slot({ on, color, onPress, children, label, style }: { on: boolean; color: string; onPress: () => void; children: ReactNode; label: string; style?: object }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label} style={[{ flex: 1 }, style]}>
      {(st) => {
        const { hovered, pressed, focused } = st as { hovered?: boolean; pressed: boolean; focused?: boolean };
        return (
          <PixelBox fill={on ? color + '33' : hovered ? '#1d2d5e' : '#0b1430'} hi={on ? color : hovered ? '#4a68b8' : '#2d4282'} lo="#04060f" edge="#04060f" shadow={pressed ? 0 : 1} style={[styles.slot, { transform: [{ translateY: pressed ? U : on ? -U : 0 }] }]}>
            {children}
            {focused ? <FocusRing /> : null}
          </PixelBox>
        );
      }}
    </Pressable>
  );
}

function Box({ children, edge, style }: { children: ReactNode; edge?: string; style?: object }) {
  return (
    <PixelBox fill="rgba(6,10,28,0.85)" hi={edge ?? '#22356f'} lo="#04060f" style={[styles.card, style]}>
      {children}
    </PixelBox>
  );
}

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

const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhexOf = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/**
 * Checks a round three ways: sha256(secret) is the commitment this player saw before staking (not just the one in
 * the same reply), the seed is sha256(secret | round | every bet signature, sorted), and the outcome follows from
 * the seed by the rules in rpc-backend/functions/games.mjs.
 */
function useVerified(r: RoundResult | undefined) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    setOk(null);
    const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (!r || !subtle || !/^[0-9a-f]{64}$/.test(r.secret)) return;
    (async () => {
      const secret = unhexOf(r.secret);
      const commit = hexOf(new Uint8Array(await subtle.digest('SHA-256', secret)));
      if (commit !== r.commit || (r.committed && r.committed !== commit)) return false;
      const sigs = r.bets.map((b) => b.sig).sort().join(',');
      const enc = new TextEncoder();
      const msg = new Uint8Array([...secret, ...enc.encode(String(r.round)), ...enc.encode(sigs)]);
      const seed = new Uint8Array(await subtle.digest('SHA-256', msg));
      if (hexOf(seed) !== r.seed) return false;
      const n = BigInt('0x' + hexOf(seed.slice(0, 16)));
      const o = r.outcome;
      if (o.collapsed !== undefined && Number(n % 5n) !== o.collapsed) return false;
      if (o.crash !== undefined) {
        let m = (95n * 1_000_000_000n) / (1_000_000_000n - (n % 1_000_000_000n));
        if (m < 100n) m = 100n;
        if (m > 1_000_000n) m = 1_000_000n;
        if (Number(m) / 100 !== o.crash) return false;
      }
      if (o.winner && r.decimals !== undefined) {
        const units = (ui: string) => { const [w, f = ''] = ui.split('.'); return BigInt(w) * 10n ** BigInt(r.decimals!) + BigInt((f + '0'.repeat(r.decimals!)).slice(0, r.decimals!) || '0'); };
        const total = r.bets.reduce((t, b) => t + units(b.amount), 0n);
        let pick = n % total;
        let winner = r.bets[r.bets.length - 1]?.who;
        for (const b of r.bets) { const a = units(b.amount); if (pick < a) { winner = b.who; break; } pick -= a; }
        if (winner !== o.winner) return false;
      }
      return true;
    })()
      .then(setOk)
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
  const { desktop } = useLayout();
  // Esc closes the table; 1 to 5 pick a tunnel
  useEffect(() => {
    if (!game || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') useArcade.getState().open(null);
      else if (game === 'tunnel' && /^[1-5]$/.test(e.key)) useArcade.getState().setChoice(Number(e.key) - 1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [game]);
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
  const stakeLabel = busy ? 'WAITING FOR WALLET' : !connected ? 'CONNECT A WALLET' : open ? `STAKE ${amount} ${TK}` : `NEXT ROUND IN ${left}s`;
  const pick = game === 'pot' ? 0 : choice[game];

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 90 }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => useArcade.getState().open(null)} accessibilityLabel="Close game" />
      <Frame glow={meta.color} style={[styles.panel, { maxWidth: desktop ? 520 : 440 }]}>
        <View style={styles.head}>
          <PixelBox fill={meta.color + '22'} hi={meta.color} lo="#04060f" style={styles.badge}>
            <PixIcon name={GAME_ICON[game]} size={36} />
          </PixelBox>
          <View style={{ flex: 1 }}>
            <T v="display" style={{ fontSize: 28, lineHeight: 30, color: meta.color, letterSpacing: 1 }} numberOfLines={1}>
              {meta.name.toUpperCase()}
            </T>
            <T v="muted" style={{ fontSize: 13 }} numberOfLines={1}>
              {meta.line}
            </T>
          </View>
          <IconBtn onPress={() => useArcade.getState().open(null)} label="Close game" kbd="ESC">
            <PixIcon name="close" size={18} />
          </IconBtn>
        </View>

        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 4 }} showsVerticalScrollIndicator={false}>
          <View style={styles.row}>
            {(['ore', 'skr'] as TokenId[]).map((t) => (
              <Slot key={t} on={token === t} color={meta.color} onPress={() => useArcade.getState().setToken(t)} label={`${t.toUpperCase()} table`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <PixIcon name={t === 'ore' ? 'ore' : 'skr'} size={20} />
                  <T v="display" style={{ fontSize: 19, color: token === t ? meta.color : COLORS.text }}>
                    {t.toUpperCase()} TABLE
                  </T>
                </View>
                <T v="bold" style={{ fontSize: 11, color: COLORS.muted }}>
                  {balance[t] === null ? '' : `you hold ${fmtAmt(balance[t] ?? 0)}`}
                </T>
              </Slot>
            ))}
          </View>

          {!cfg ? (
            <Box>
              <T v="bold" style={{ textAlign: 'center' }}>
                {cfgError ?? 'Opening the tables'}
              </T>
              {cfgError ? <Btn kind="ghost" label="TRY AGAIN" onPress={() => useArcade.getState().open(game)} /> : null}
            </Box>
          ) : !tb?.ready ? (
            <Box>
              <PixIcon name="lock" size={32} style={{ alignSelf: 'center' }} />
              <T v="display" style={{ textAlign: 'center', fontSize: 20 }}>
                THE {TK} TABLE IS NOT OPEN YET
              </T>
              <T v="muted" style={{ fontSize: 13, textAlign: 'center' }}>
                {tb?.reason ?? 'Check back soon.'}
              </T>
            </Box>
          ) : (
            <>
              <Box edge={open ? meta.color : undefined}>
                <View style={styles.rowBetween}>
                  <T v="display" style={{ fontSize: 18, letterSpacing: 1, color: open ? COLORS.green : COLORS.muted }}>
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
                    return <View key={i} style={[styles.seg, { backgroundColor: on ? (closedPart ? '#ff6b6b' : meta.color) : '#0b1330' }]} />;
                  })}
                </View>
                <T v="muted" style={{ fontSize: 11 }} numberOfLines={1}>
                  Round {round} · house commitment {commit && commit.round === round ? `${commit.hash.slice(0, 10)}…${commit.hash.slice(-6)}` : '…'}
                </T>
              </Box>

              {game === 'tunnel' ? (
                <View style={styles.row}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Slot key={i} on={pick === i} color={meta.color} onPress={() => useArcade.getState().setChoice(i)} label={`Tunnel ${i + 1}`} style={{ height: 92 }}>
                      <PixIcon name="tunnel" size={40} />
                      <T v="display" style={{ fontSize: 20, color: pick === i ? meta.color : COLORS.muted }}>
                        {i + 1}
                      </T>
                    </Slot>
                  ))}
                </View>
              ) : null}
              {game === 'crash' ? (
                <Box>
                  <T v="label" style={{ textAlign: 'center' }}>
                    Cash out at
                  </T>
                  <View style={[styles.row, { flexWrap: 'wrap', justifyContent: 'center' }]}>
                    {CRASH_TARGETS.map((c) => (
                      <Slot key={c} on={pick === c} color={meta.color} onPress={() => useArcade.getState().setChoice(c)} label={`Cash out at ${(c / 10).toFixed(1)}x`} style={{ flex: 0, width: '31%' }}>
                        <T v="display" style={{ fontSize: 22, color: pick === c ? meta.color : COLORS.text }}>
                          {(c / 10).toFixed(1)}x
                        </T>
                        <T v="bold" style={{ fontSize: 10, color: COLORS.muted }}>
                          {Math.min(95, 950 / c).toFixed(0)}% to hit
                        </T>
                      </Slot>
                    ))}
                  </View>
                </Box>
              ) : null}
              {game === 'pot' ? (
                <Box>
                  <PixIcon name="pot" size={56} style={{ alignSelf: 'center' }} />
                  <T v="muted" style={{ fontSize: 13, textAlign: 'center' }}>
                    The more you stake, the more tickets you hold. One ticket takes the pot.
                  </T>
                </Box>
              ) : null}

              <View style={styles.row}>
                {tb.chips.map((c, i) => (
                  <Slot key={c} on={chip === i} color={meta.color} onPress={() => useArcade.getState().setChip(i)} label={`Stake ${c} ${TK}`} style={{ height: 62 }}>
                    <T v="display" style={{ fontSize: 24, color: chip === i ? meta.color : COLORS.text }}>
                      {c}
                    </T>
                    <T v="display" style={{ fontSize: 13, color: COLORS.muted }}>
                      {TK}
                    </T>
                  </Slot>
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
                <Box>
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
                </Box>
              ) : null}

              {last ? <ResultCard r={last} verified={verified} color={meta.color} /> : null}
              <Pressable onPress={() => setHow((v) => !v)} accessibilityRole="button">
                <T v="bold" style={{ fontSize: 12, color: COLORS.teal, textAlign: 'center' }}>
                  {how ? 'Hide how it works' : 'How it works and how to check it'}
                </T>
              </Pressable>
              {how ? (
                <Box>
                  <T v="muted" style={{ fontSize: 13 }}>
                    {meta.how}
                  </T>
                  <T v="muted" style={{ fontSize: 12 }}>
                    Stakes go to the Gali house wallet and winners are paid from it automatically. Before every round the house shows a hash of its secret. After the round it shows the secret, so the draw can be checked: the hash of the secret must equal the commitment, and the winner comes from the secret plus every stake in the round. Limit {tb.capUnits && tb.decimals !== undefined ? fmtAmt(Number(tb.capUnits) / 10 ** tb.decimals) : ''} {TK} per wallet per round. 18+ only. Only play with what you can afford to lose.
                  </T>
                </Box>
              ) : null}
            </>
          )}
        </ScrollView>
      </Frame>
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
    <Box edge={m && m.net > 0 ? COLORS.gold : undefined}>
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
            <View key={i} style={[styles.mini, i === r.outcome.collapsed && { borderColor: COLORS.red, backgroundColor: 'rgba(226,73,59,0.18)' }]}>
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
          {verified === true ? 'Checked: the secret, the seed and the result match the commitment.' : verified === false ? 'This round does not check out against the commitment.' : `Commitment ${r.commit.slice(0, 12)}…`}
        </T>
      </View>
    </Box>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(3,6,18,0.5)', zIndex: 60, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
  panel: { width: '100%', maxHeight: '100%', padding: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  slot: { minHeight: 50, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 6, flex: 1 },
  card: { padding: 12, gap: 6 },
  segs: { flexDirection: 'row', gap: U, padding: U, backgroundColor: '#04060f' },
  seg: { flex: 1, height: 10 },
  mini: { flex: 1, height: 36, borderWidth: U, borderColor: '#22356f', alignItems: 'center', justifyContent: 'center' },
});
