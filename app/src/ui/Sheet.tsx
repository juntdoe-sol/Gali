import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ACHIEVEMENTS, BOOST_TIERS, COLORS, GEAR, GEAR_KINDS, levelFromXp, localDay, MOTHERLODE_ODDS, MOTHERLODE_POINTS,
  BLOCKS, MOTHERLODE_POOL_SHARE, QUESTS, usd, RARITY_COLOR, SEASON, type Gear, type GearKind,
} from '../game/constants';
import { GEAR_ICON as PIXEL_ICON } from './gearIcons';
import { GEAR_ICON, ITEM_ICON } from './icons';
import { useGame, useLevelXp, useOwnedMask, usePoints } from '../game/store';
import { chainReady, CLUSTER, PROGRAM_ID_STR, short, SKR_MINT_STR, type BoardRound, type LeaderRow } from '../chain/light';
import { loadBoard, loadChain } from '../chain/lazy';
import { ADMIN_FEE, fmtSol, POT_FEE, practiceMotherlode, practiceOreMotherlode, simPot, soloMask } from '../game/pot';
import { UnclaimedRow } from './Dock';
import { Bar, Btn, Card, Pill, T } from './kit';

type Tab = 'quests' | 'rounds' | 'gear' | 'skr' | 'ranks' | 'me';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'quests', label: 'Quests', icon: '📜' },
  { id: 'rounds', label: 'Rounds', icon: '📋' },
  { id: 'gear', label: 'Gear', icon: '⛏' },
  { id: 'skr', label: 'SKR', icon: '◈' },
  { id: 'ranks', label: 'Ranks', icon: '🏆' },
  { id: 'me', label: 'Me', icon: '🙂' },
];

export function Sheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('quests');
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.grabber} />
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabOn]}>
              <T style={{ fontSize: 18 }}>{t.icon}</T>
              <T v="bold" style={{ fontSize: 11, color: tab === t.id ? COLORS.text : COLORS.muted }}>
                {t.label}
              </T>
            </Pressable>
          ))}
        </View>
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>
          {tab === 'quests' && <Quests />}
          {tab === 'rounds' && <Rounds />}
          {tab === 'gear' && <GearTab />}
          {tab === 'skr' && <SkrTab />}
          {tab === 'ranks' && <Ranks />}
          {tab === 'me' && <Me />}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Quests() {
  const save = useGame((s) => s.save);
  const claim = useGame((s) => s.claimQuest);
  const today = save.questDay === localDay();
  const days = Math.max(0, Math.ceil((SEASON.endsAt - Date.now()) / 86_400_000));
  return (
    <>
      <Card glow={COLORS.teal}>
        <T v="label">{SEASON.name}</T>
        <T v="bold" style={{ marginTop: 4 }}>
          Ends in {days} days. Top miners by points take the season crown.
        </T>
      </Card>
      <T v="display" style={{ fontSize: 20, marginTop: 6 }}>
        Daily quests
      </T>
      {QUESTS.map((q) => {
        const prog = today ? save.questProgress[q.id] ?? 0 : 0;
        const done = prog >= q.target;
        const claimed = today && save.questClaimed.includes(q.id);
        return (
          <Card key={q.id} style={[styles.rowCard, claimed && { opacity: 0.5 }]}>
            <View style={{ flex: 1, gap: 5 }}>
              <T v="bold">{q.label}</T>
              <Bar pct={(prog / q.target) * 100} colors={[COLORS.pink, COLORS.gold]} />
              <T v="muted">
                {Math.min(prog, q.target)}/{q.target} · +{q.rewardXp} XP
              </T>
            </View>
            <Btn small label={claimed ? '✓' : done ? 'Claim' : '…'} disabled={!done || claimed} onPress={() => claim(q.id)} />
          </Card>
        );
      })}
      <T v="display" style={{ fontSize: 20, marginTop: 6 }}>
        Achievements
      </T>
      <View style={styles.grid}>
        {ACHIEVEMENTS.map((a) => {
          const got = save.achievements.includes(a.id);
          return (
            <View key={a.id} style={[styles.badge, got && { borderColor: COLORS.gold, opacity: 1 }]}>
              <T style={{ fontSize: 20 }}>{got ? '🏅' : '🔒'}</T>
              <T v="bold">{a.label}</T>
              <T v="muted">{a.desc}</T>
            </View>
          );
        })}
      </View>
    </>
  );
}

function GearIcon({ g }: { g: Gear }) {
  const px = PIXEL_ICON[g.key];
  return (
    <View style={[styles.gearIcon, { borderColor: RARITY_COLOR[g.rarity], backgroundColor: g.accent + '22' }]}>
      {px ? (
        <Image source={px} style={{ width: 40, height: 40 }} {...({ dataSet: { pixelart: '1' } } as object)} />
      ) : (
        <T style={{ fontSize: 24 }}>{ITEM_ICON[g.key] ?? GEAR_ICON[g.kind]}</T>
      )}
    </View>
  );
}

function GearTab() {
  const owned = useOwnedMask();
  const save = useGame((s) => s.save);
  const skr = useGame((s) => s.wallet.skr);
  const owner = useGame((s) => s.wallet.owner);
  const { buyGear, equip } = useGame.getState();
  const [kind, setKind] = useState<GearKind>('pickaxe');
  const equipped = [save.pickaxe, save.helmet, save.outfit, save.pet];
  const items = GEAR.filter((g) => g.kind === kind);
  return (
    <>
      <T v="muted">
        {GEAR.length} items, priced in dollars and payable in SKR or ORE, so neither token is the tax. Gear is cosmetic and never changes your odds. {Math.round(MOTHERLODE_POOL_SHARE * 100)}% of every SKR sale goes back into the motherlode players are chasing; the rest runs the game.
      </T>
      <View style={styles.seg}>
        {GEAR_KINDS.map((k) => (
          <Pressable key={k.kind} onPress={() => setKind(k.kind)} style={[styles.segBtn, kind === k.kind && styles.tabOn]}>
            <T v="bold" style={{ fontSize: 12, color: kind === k.kind ? COLORS.text : COLORS.muted }}>
              {GEAR_ICON[k.kind]} {k.label}
            </T>
          </Pressable>
        ))}
      </View>
      {items.map((g) => {
        const has = Boolean(owned & (1 << g.id));
        const on = equipped.includes(g.key);
        return (
          <Card key={g.key} style={[styles.rowCard, { borderColor: RARITY_COLOR[g.rarity] + '99' }]}>
            <GearIcon g={g} />
            <View style={{ flex: 1 }}>
              <T v="bold">{g.name}</T>
              <T v="bold" style={{ fontSize: 11, color: RARITY_COLOR[g.rarity], textTransform: 'capitalize' }}>
                {g.rarity} {g.kind}
              </T>
              <T v="muted">{g.perk}</T>
            </View>
            {has ? (
              <Btn small label={on ? (g.kind === 'pet' ? 'Unequip' : 'Equipped') : 'Equip'} disabled={on && g.kind !== 'pet'} onPress={() => equip(g.key)} />
            ) : (
              <Btn
                small
                kind="skr"
                label={`${g.priceSkr.toLocaleString()} SKR`}
                sub={usd(g.priceSkr)}
                disabled={!owner || skr < g.priceSkr}
                onPress={() => void buyGear(g.key)}
              />
            )}
          </Card>
        );
      })}
    </>
  );
}

function MotherlodeCard() {
  const owner = useGame((s) => s.wallet.owner);
  const live = Boolean(owner && chainReady);
  const skrPool = useGame((s) => (live ? s.wallet.pool : practiceMotherlode(s.roundId)));
  const orePool = useGame((s) => (live ? s.wallet.orePool : practiceOreMotherlode(s.roundId)));
  const won = useGame((s) => s.wallet.player?.skrWon ?? 0);
  return (
    <Card glow={COLORS.teal}>
      <T v="label">💎 Two motherlodes, one hit{live ? '' : ' (practice)'}</T>
      <View style={{ flexDirection: 'row', gap: 18, marginVertical: 4 }}>
        <View>
          <T v="display" style={{ fontSize: 30, color: COLORS.teal }}>
            {orePool.toLocaleString(undefined, { maximumFractionDigits: 1 })} ORE
          </T>
          <T v="muted" style={{ fontSize: 11 }}>
            ORE&apos;S MOTHERLODE
          </T>
        </View>
        <View>
          <T v="display" style={{ fontSize: 30, color: COLORS.gold }}>
            {Math.floor(skrPool).toLocaleString()} SKR
          </T>
          <T v="muted" style={{ fontSize: 11 }}>
            GALI&apos;S SKR POOL · ~{usd(skrPool)}
          </T>
        </View>
      </View>
      <T>
        ORE adds 0.2 ORE to its motherlode every round. 1 round in {MOTHERLODE_ODDS} it hits, and the whole pool goes to the miners on the gold spot, split by their SOL there.
      </T>
      <T style={{ marginTop: 6 }}>
        Gali pays its SKR pool in the same round, to the same winners, split the same way, plus {MOTHERLODE_POINTS.toLocaleString()} bonus points each. An early hit pays less; a late one pays more.
      </T>
      <T v="muted" style={{ marginTop: 6 }}>
        The SKR pool fills from {Math.round(MOTHERLODE_POOL_SHARE * 100)}% of every gear sale, and anyone can top it up. Gali never mints SKR: the pool is filled by the people chasing it.{owner && won > 0 ? ` You've won ${won.toLocaleString()} SKR.` : ''}
      </T>
    </Card>
  );
}

function SkrTab() {
  const w = useGame((s) => s.wallet);
  const { stake, unstake, connect } = useGame.getState();
  const [amt, setAmt] = useState('1000');
  const stakedAmt = w.player?.stakedSkr ?? 0;
  const tier = [...BOOST_TIERS].reverse().find((t) => stakedAmt >= t.min)!;
  const next = BOOST_TIERS.find((t) => t.min > stakedAmt);
  if (!w.owner)
    return (
      <>
      <MotherlodeCard />
      <Card glow={COLORS.skr}>
        <T v="display" style={{ fontSize: 22 }}>
          Stake SKR, score harder
        </T>
        <T style={{ marginVertical: 8 }}>Stake SKR in the Gali vault to boost every win: 1.25x at 5,000 SKR (~$90), 1.5x at 50,000 SKR (~$900). Unstake any time.</T>
        <Btn kind="skr" label="Connect wallet" onPress={() => void connect()} />
      </Card>
      </>
    );
  const n = Number(amt) || 0;
  return (
    <>
      <MotherlodeCard />
      <Card glow={COLORS.skr}>
        <T v="label">Your boost</T>
        <T v="display" style={{ fontSize: 34, color: COLORS.skr }}>
          {tier.bps / 10_000}x
        </T>
        <T>
          {stakedAmt.toLocaleString()} SKR staked · {w.skr.toLocaleString()} SKR in wallet
        </T>
        {next ? (
          <View style={{ marginTop: 8, gap: 4 }}>
            <Bar pct={(stakedAmt / next.min) * 100} colors={['#9fd65a', COLORS.skr]} />
            <T v="muted">
              {(next.min - stakedAmt).toLocaleString()} more SKR for {next.label}
            </T>
          </View>
        ) : null}
      </Card>
      <Card>
        <T v="label">Amount</T>
        <TextInput
          id="stake-amount"
          value={amt}
          onChangeText={(v) => setAmt(v.replace(/[^0-9.]/g, ''))}
          keyboardType="numeric"
          style={styles.input}
          placeholderTextColor={COLORS.muted}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Btn kind="skr" label="Stake" style={{ flex: 1 }} disabled={n <= 0 || n > w.skr} onPress={() => void stake(n)} />
          <Btn label="Unstake" style={{ flex: 1 }} disabled={n <= 0 || n > stakedAmt} onPress={() => void unstake(n)} />
        </View>
      </Card>
      {BOOST_TIERS.slice(1).map((t) => (
        <Card key={t.min} style={styles.rowCard}>
          <T v="display" style={{ fontSize: 22, color: stakedAmt >= t.min ? COLORS.skr : COLORS.muted }}>
            {t.bps / 10_000}x
          </T>
          <T style={{ flex: 1 }}>Stake {t.min.toLocaleString()} SKR</T>
          {stakedAmt >= t.min ? <Pill text="ACTIVE" color={COLORS.skr} fg="#1b2a00" /> : null}
        </Card>
      ))}
      <T v="muted">
        {CLUSTER === 'devnet' ? `Devnet build uses a test SKR mint (${short(SKR_MINT_STR)}). ` : ''}SKR is the native asset of the Solana Mobile ecosystem.
      </T>
    </>
  );
}

const BOT_NAMES = ['Batu', 'Emas', 'Intan', 'Perak', 'Kilat', 'Rimba', 'Sagu', 'Tembaga'];
/** Practice mode: stand-in history built from the same simulated crowd the map shows. */
function practiceRounds(before: number, n: number): BoardRound[] {
  return [...Array(n).keys()].map((k) => {
    const id = before - 1 - k;
    const h = (Math.imul(id, 2654435761) >>> 0) / 4294967296;
    const winning = Math.floor(h * BLOCKS);
    const pot = simPot(id, 1);
    const split = (soloMask(id) & (1 << winning)) === 0;
    const motherlode = Math.floor(h * 1e6) % MOTHERLODE_ODDS === 0;
    const fees = pot.perBlock.reduce((sum, d, i) => sum + d * ADMIN_FEE + (i === winning ? 0 : d * (1 - ADMIN_FEE) * POT_FEE), 0);
    return {
      roundId: id,
      winning,
      perSquare: pot.perBlock,
      total: pot.total,
      returned: pot.total - fees,
      fees,
      oreReward: pot.perBlock[winning] > 0 ? 1 : 0,
      motherlodeOre: motherlode ? practiceOreMotherlode(id) : 0,
      motherlode,
      split,
      winner: split ? null : `${BOT_NAMES[Math.floor(h * 97) % BOT_NAMES.length]}-bot`,
      miners: pot.miners,
      settled: true,
    };
  });
}

function Rounds() {
  const owner = useGame((s) => s.wallet.owner);
  const roundId = useGame((s) => s.roundId);
  const onChain = Boolean(owner && chainReady);
  const [rows, setRows] = useState<BoardRound[] | null>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null);
    (onChain ? loadBoard().then((b) => b.fetchPastBoardRounds(roundId)) : Promise.resolve(practiceRounds(roundId, 12)))
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
    // refresh when a round finishes or on demand, not on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChain, at, roundId]);
  return (
    <>
      <Card>
        <T v="label">Your rewards</T>
        <View style={{ marginTop: 8 }}>
          <UnclaimedRow />
        </View>
        <T v="muted">Each finished round credits the SOL you get back and the ORE you mined. Claim whenever you like: nothing expires. ORE claimed before it is refined pays ORE's own 10% fee.</T>
      </Card>
      <View style={[styles.rowCard, { justifyContent: 'space-between' }]}>
        <T v="display" style={{ fontSize: 20 }}>
          Past rounds{onChain ? '' : ' · practice'}
        </T>
        <Btn small label="Refresh" onPress={() => setAt(Date.now())} />
      </View>
      {rows === null ? (
        <Card>
          <T>Loading rounds…</T>
        </Card>
      ) : !rows.length ? (
        <Card>
          <T>No finished rounds yet. They show up here once they are settled.</T>
        </Card>
      ) : (
        rows.map((r) => {
          const p = r;
          const win = r.winning ?? 0;
          const nobody = !(p.perSquare[win] > 0);
          const who = nobody
            ? 'Nobody on the gold spot'
            : p.split
              ? `Split · ${p.miners || '…'} miner${p.miners === 1 ? '' : 's'}`
              : p.winner
                ? `★ Solo · ${p.winner === owner ? 'You' : p.winner.length > 20 ? short(p.winner) : p.winner}`
                : '★ Solo · 1 wallet (claim pending)';
          return (
            <View key={r.roundId} style={[styles.past, p.winner && p.winner === owner && { borderColor: COLORS.gold }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="bold">
                  #{(r.roundId % 100000).toLocaleString()} · spot {win + 1}
                  {p.motherlode ? '  💎 MOTHERLODE' : ''}
                </T>
                <T v="muted" style={{ fontSize: 11 }}>
                  {p.settled ? `${p.miners} miner${p.miners === 1 ? '' : 's'}` : 'settling'}
                </T>
              </View>
              <T style={{ marginTop: 2, color: p.split || nobody ? COLORS.text : COLORS.gold }}>{who}</T>
              <T v="muted" style={{ fontSize: 12, marginTop: 2 }}>
                ◎ {fmtSol(p.total)} SOL in · {fmtSol(p.fees)} fees · ◈ {p.oreReward.toFixed(2)} ORE
                {p.motherlodeOre > 0 ? ` + ${p.motherlodeOre.toFixed(2)} motherlode` : ''}
              </T>
            </View>
          );
        })
      )}
    </>
  );
}

function Ranks() {
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const owner = useGame((s) => s.wallet.owner);
  const points = usePoints();
  const xp = useLevelXp();
  useEffect(() => {
    if (!chainReady) return;
    loadChain()
      .then((c) => c.fetchLeaderboard())
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  const list = rows ?? [];
  return (
    <>
      <T v="display" style={{ fontSize: 20 }}>
        Top miners · on-chain
      </T>
      {!chainReady || !list.length ? (
        <Card>
          <T>{rows === null && chainReady ? 'Loading the leaderboard…' : 'The on-chain board fills up as miners play rounds.'}</T>
          <T v="muted" style={{ marginTop: 6 }}>
            You: {points.toLocaleString()} pts · level {levelFromXp(xp)}
          </T>
        </Card>
      ) : (
        list.map((r, k) => (
          <View key={r.owner} style={[styles.rank, r.owner === owner && { borderColor: COLORS.gold }]}>
            <T v="display" style={{ width: 34, fontSize: 18, textAlign: 'center' }}>
              {k < 3 ? ['🥇', '🥈', '🥉'][k] : k + 1}
            </T>
            <T v="bold" style={{ flex: 1 }}>
              {short(r.owner)}
              {r.owner === owner ? '  (you)' : ''}
            </T>
            <T v="muted">Lv {r.level}</T>
            <T v="black" style={{ color: COLORS.gold, minWidth: 70, textAlign: 'right' }}>
              {r.points.toLocaleString()}
            </T>
          </View>
        ))
      )}
    </>
  );
}

function Me() {
  const w = useGame((s) => s.wallet);
  const save = useGame((s) => s.save);
  const { connect, disconnect, airdrop, setMute, refreshWallet, sweepSession } = useGame.getState();
  return (
    <>
      <Card>
        <T v="label">Wallet</T>
        {w.owner ? (
          <>
            <T v="bold" style={{ marginTop: 4 }}>
              {short(w.owner)} · {w.sol.toFixed(3)} SOL · {w.skr.toLocaleString()} SKR
            </T>
            <T v="muted" style={{ marginTop: 4 }}>
              Session key: {w.sessionSol.toFixed(3)} SOL to deploy
              {w.player?.sessionExpires ? ` · expires ${new Date(w.player.sessionExpires * 1000).toLocaleString()}` : ''}
            </T>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Btn small label="Refresh" onPress={() => void refreshWallet()} />
              {w.sessionSol > 0.001 ? <Btn small label="Return session SOL" onPress={() => void sweepSession()} /> : null}
              {CLUSTER === 'devnet' ? <Btn small label="+1 devnet SOL" onPress={() => void airdrop()} /> : null}
              <Btn small kind="ghost" label="Disconnect" onPress={() => void disconnect()} />
            </View>
          </>
        ) : (
          <>
            <T style={{ marginVertical: 6 }}>Connect a Solana wallet (Seed Vault on Seeker) to mine ORE on-chain with SOL, climb the leaderboard, stake SKR and buy gear.</T>
            <Btn kind="skr" label="Connect wallet" onPress={() => void connect()} />
          </>
        )}
      </Card>
      <View style={styles.grid}>
        {[
          ['Rounds played', String(w.player?.rounds ?? save.digs)],
          ['SOL returned', (w.player?.solWon ?? save.practiceUnclaimedSol ?? 0).toFixed(3)],
          ['SKR won', Math.floor(w.player?.skrMined ?? save.practiceSkr).toLocaleString()],
          ['Wins', String(w.player?.wins ?? save.wins)],
          ['Day streak', String(w.player?.streak ?? save.dayStreak)],
          ['Moles bonked', String(save.moles)],
        ].map(([k, v]) => (
          <View key={k} style={styles.badge}>
            <T v="display" style={{ fontSize: 24 }}>
              {v}
            </T>
            <T v="muted">{k}</T>
          </View>
        ))}
      </View>
      <Card style={styles.rowCard}>
        <T style={{ flex: 1 }}>Mute sound</T>
        <Switch id="mute" value={save.muted} onValueChange={setMute} trackColor={{ true: COLORS.teal, false: COLORS.card2 }} />
      </Card>
      <T v="muted">How it works: each minute is a round on an island with 25 mining spots. Put SOL on 1 to 25 spots. One spot strikes gold. Its miners split the whole pot (the SOL on every spot, after a 1% fee and 10% of the losing spots) by their SOL on the gold spot; SOL on the other spots is lost. The gold spot also mines ORE, split the same way, or on one of the round's 10 solo spots (★) taken whole by one miner, with odds equal to their share. Fewer spots pay more points: 1,000 for a single spot, 40 for all 25. A 1-in-500 motherlode pays out the whole SKR Motherlode Pool on top. Everything lands in Unclaimed until you claim it. This is a game of chance: only play with SOL you can afford to lose.</T>
      <Pressable onPress={() => Linking.openURL(`https://explorer.solana.com/address/${PROGRAM_ID_STR}?cluster=${CLUSTER}`)}>
        <T v="muted" style={{ textDecorationLine: 'underline' }}>
          Program {short(PROGRAM_ID_STR)} on Solana Explorer
        </T>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#040817aa' },
  sheet: {
    maxHeight: '82%',
    backgroundColor: COLORS.bg2,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderColor: COLORS.line,
    borderWidth: 2,
    borderBottomWidth: 0,
  },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: COLORS.line, marginTop: 8 },
  tabs: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 8, gap: 4, borderBottomColor: COLORS.line, borderBottomWidth: 2, paddingBottom: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12 },
  past: { padding: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.card },
  tabOn: { backgroundColor: COLORS.card2 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '48.5%', backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 2, borderRadius: 14, padding: 10, gap: 2, opacity: 0.85 },
  gearIcon: { width: 54, height: 54, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  swatch: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 10 },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: '#00000055', borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', padding: 10 },
  input: { marginTop: 6, backgroundColor: '#00000055', borderColor: COLORS.line, borderWidth: 2, borderRadius: 12, color: COLORS.text, fontSize: 20, paddingHorizontal: 12, paddingVertical: 8, fontFamily: 'Jersey15_400Regular' },
});
