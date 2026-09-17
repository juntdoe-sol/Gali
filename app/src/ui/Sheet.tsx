import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ACHIEVEMENTS, BOOST_TIERS, COLORS, GEAR, GEAR_KINDS, levelFromXp, localDay, MOTHERLODE_ODDS, MOTHERLODE_POINTS,
  MOTHERLODE_POOL_SHARE, MOTHERLODE_SKR, QUESTS, REWARDS_POOL_SHARE, ROUND_REWARD_SKR, usd, RARITY_COLOR, SEASON, type Gear, type GearKind,
} from '../game/constants';
import { GEAR_ICON, ITEM_ICON } from './icons';
import { useGame, useLevelXp, useOwnedMask, usePoints } from '../game/store';
import { chainReady, CLUSTER, fetchLeaderboard, PROGRAM_ID, short, SKR_MINT, type LeaderRow } from '../chain/client';
import { Bar, Btn, Card, Pill, T } from './kit';

type Tab = 'quests' | 'gear' | 'skr' | 'ranks' | 'me';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'quests', label: 'Quests', icon: '📜' },
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
  return (
    <View style={[styles.gearIcon, { borderColor: RARITY_COLOR[g.rarity], backgroundColor: g.accent + '33' }]}>
      <View style={[styles.swatch, { backgroundColor: g.color }]} />
      <T style={{ fontSize: 24 }}>{ITEM_ICON[g.key] ?? GEAR_ICON[g.kind]}</T>
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
        {GEAR.length} items bought with SKR. Gear is cosmetic and never changes your odds. Each sale feeds the pools: 30% Motherlode, 40% Rewards (paid to miners), 30% treasury.
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
  const pool = useGame((s) => s.wallet.pool);
  const owner = useGame((s) => s.wallet.owner);
  const won = useGame((s) => s.wallet.player?.skrWon ?? 0);
  return (
    <Card glow={COLORS.teal}>
      <T v="label">💎 SKR Motherlode Pool</T>
      <T v="display" style={{ fontSize: 34, color: COLORS.teal }}>
        {chainReady ? `${pool.toLocaleString()} SKR` : 'Opens on devnet'}
      </T>
      <T>
        1 round in {MOTHERLODE_ODDS} is a motherlode. Miners on the winning block share {MOTHERLODE_SKR.toLocaleString()} SKR (~{usd(MOTHERLODE_SKR)}) by their SOL there, and each gets {MOTHERLODE_POINTS.toLocaleString()} bonus points. Payouts are capped by the pool.
      </T>
      <T v="muted" style={{ marginTop: 6 }}>
        The pool fills with {Math.round(MOTHERLODE_POOL_SHARE * 100)}% of every gear sale, and anyone can top it up. Another {Math.round(REWARDS_POOL_SHARE * 100)}% fills the Rewards Pool that pays {ROUND_REWARD_SKR} SKR to SOL miners every round.{owner && won > 0 ? ` You've won ${won.toLocaleString()} SKR.` : ''}
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
        {CLUSTER === 'devnet' ? `Devnet build uses a test SKR mint (${short(SKR_MINT.toBase58())}). ` : ''}SKR is the native asset of the Solana Mobile ecosystem.
      </T>
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
    fetchLeaderboard()
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
  const { connect, disconnect, airdrop, setMute, refreshWallet } = useGame.getState();
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
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
              <Btn small label="Refresh" onPress={() => void refreshWallet()} />
              {CLUSTER === 'devnet' ? <Btn small label="+1 devnet SOL" onPress={() => void airdrop()} /> : null}
              <Btn small kind="ghost" label="Disconnect" onPress={() => void disconnect()} />
            </View>
          </>
        ) : (
          <>
            <T style={{ marginVertical: 6 }}>Connect a Solana wallet (Seed Vault on Seeker) to mine on-chain with SOL, climb the leaderboard, stake SKR and buy gear.</T>
            <Btn kind="skr" label="Connect wallet" onPress={() => void connect()} />
          </>
        )}
      </Card>
      <View style={styles.grid}>
        {[
          ['Rounds played', String(w.player?.rounds ?? save.digs)],
          ['SOL won', (w.player?.solWon ?? 0).toFixed(3)],
          ['SKR mined', Math.floor(w.player?.skrMined ?? save.practiceSkr).toLocaleString()],
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
      <T v="muted">How it works: each minute is a round on a quarry with 25 mining spots. Put SOL on 1 to 25 spots. One spot strikes gold, and everyone on it splits 90% of the round's SOL pot in proportion to their SOL there. The round also mines 200 SKR: half the time it is split the same way, the other half one lucky winner takes it all, with odds equal to their share. Fewer blocks also pay more points: 1,000 for a single block, 40 for all 25. A 1-in-625 motherlode adds 5,000 SKR. This is a game of chance: only play with SOL you can afford to lose.</T>
      <Pressable onPress={() => Linking.openURL(`https://explorer.solana.com/address/${PROGRAM_ID.toBase58()}?cluster=${CLUSTER}`)}>
        <T v="muted" style={{ textDecorationLine: 'underline' }}>
          Program {short(PROGRAM_ID.toBase58())} on Solana Explorer
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
  tabOn: { backgroundColor: COLORS.card2 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '48.5%', backgroundColor: COLORS.card, borderColor: COLORS.line, borderWidth: 2, borderRadius: 14, padding: 10, gap: 2, opacity: 0.85 },
  gearIcon: { width: 54, height: 54, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  swatch: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 10 },
  seg: { flexDirection: 'row', gap: 4, backgroundColor: '#00000055', borderRadius: 14, padding: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 2, borderColor: 'transparent', padding: 10 },
  input: { marginTop: 6, backgroundColor: '#00000055', borderColor: COLORS.line, borderWidth: 2, borderRadius: 12, color: COLORS.text, fontSize: 20, paddingHorizontal: 12, paddingVertical: 8, fontFamily: 'PixelifySans_700Bold' },
});
