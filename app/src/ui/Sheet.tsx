import { useBrawl } from '../game/brawl';
import { FEATURE_GALI_PROGRAM } from '../config/features';
import { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ACHIEVEMENTS, BOOST_TIERS, COLORS, levelFromXp, localDay, MOTHERLODE_ODDS, MOTHERLODE_POINTS,
  BLOCKS, MOTHERLODE_POOL_SHARE, QUESTS, usd, SEASON,
} from '../game/constants';
import { isLive, isOnChain, useGame, useLevelXp, usePoints } from '../game/store';
import { chainReady, CLUSTER, oreLive, PROGRAM_ID_STR, short, SKR_MINT_STR, type BoardRound } from '../chain/light';
import { PERIOD_WORDS, useMinerRanks, useRanks, type Period } from '../game/ranks';
import { ClansSoon, ComingSoon, PeriodPicker } from './Clans';
import { loadBoard, loadChain } from '../chain/lazy';
import { ADMIN_FEE, fmtOreAmt, fmtSol, POT_FEE, practiceMotherlode, practiceOreMotherlode, simPot, soloMask } from '../game/pot';
import { UnclaimedRow } from './Dock';
import { Bar, Btn, Card, Choice, FocusRing, Frame, IconBtn, INPUT, Kbd, PixelBox, Pill, T, U } from './kit';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import { lockScreen, ORIENT_KEY, type Orient } from '../boot';
import { PixIcon } from './PixIcon';
import { GUTTER, RAIL_W, useLayout } from './layout';
import { BAR_H, SHEET_TITLE, TAB_PIX, TabBar, type SheetTab } from './TabBar';
import { BackPill } from './Lobby';
import { Inventory } from './Inventory';
import { useOreHits, type OreHit } from '../game/oreHits';

const ORE_PROGRAM_STR = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';

/** One page per bottom-bar tab. The bar is drawn inside the sheet too, so switching pages is one tap. */
export function Sheet({ tab, onTab }: { tab: SheetTab | null; onTab: (t: SheetTab | null) => void }) {
  const insets = useSafeAreaInsets();
  const { desktop, w } = useLayout();
  const close = () => onTab(null);
  const head = (
    <View style={styles.sheetHead}>
      {tab ? <PixIcon name={TAB_PIX[tab]} size={32} /> : null}
      <T v="display" style={{ fontSize: 30, lineHeight: 32, letterSpacing: 1, flex: 1 }}>
        {tab ? SHEET_TITLE[tab].toUpperCase() : ''}
      </T>
      <IconBtn onPress={close} label="Close" kbd="ESC">
        <PixIcon name="close" size={18} />
      </IconBtn>
    </View>
  );
  const body = (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} showsVerticalScrollIndicator>
      {tab === 'quests' && <Quests />}
      {tab === 'rounds' && <Rounds />}
      {tab === 'bag' && <Inventory />}
      {tab === 'skr' && FEATURE_GALI_PROGRAM && <SkrTab />}
      {tab === 'ranks' && <Ranks />}
      {tab === 'clans' && <ClansSoon />}
      {tab === 'me' && <Me />}
    </ScrollView>
  );
  if (desktop) {
    // a window beside the rail; the map stays visible to its right
    const width = Math.min(600, w - RAIL_W - GUTTER * 3);
    return (
      <Modal visible={tab !== null} animationType="fade" transparent onRequestClose={close}>
        <Pressable style={styles.deskScrim} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.deskSheet, { left: RAIL_W + GUTTER, width }]}>
          <Frame style={{ flex: 1, paddingTop: 14 }}>
            <View style={{ paddingHorizontal: 16 }}>{head}</View>
            {body}
          </Frame>
        </View>
        <TabBar active={tab} onTab={onTab} inSheet />
      </Modal>
    );
  }
  return (
    <Modal visible={tab !== null} animationType="slide" transparent onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} />
      <View style={[styles.sheet, { paddingBottom: BAR_H + insets.bottom + 8 }]}>
        <View pointerEvents="none" style={styles.sheetBg}>
          <View style={styles.sheetEdge} />
          <View style={styles.sheetHi} />
        </View>
        <View style={styles.grabber} />
        <View style={{ paddingHorizontal: 16 }}>{head}</View>
        {body}
      </View>
      <TabBar active={tab} onTab={onTab} inSheet />
    </Modal>
  );
}

/** A pixel on/off switch. */
function PixSwitch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value }} accessibilityLabel={label}>
      {(st) => (
        <PixelBox fill={value ? '#15809a' : '#050817'} hi={value ? COLORS.teal : '#02040c'} lo={value ? '#0a4250' : '#22356f'} style={styles.switch}>
          <PixelBox fill={value ? '#ffffff' : '#5f6f95'} hi={value ? '#ffffff' : '#8ea2cc'} lo={value ? '#9aeaff' : '#2d3a5e'} style={[styles.knob, { left: value ? 24 : 4 }]} />
          {(st as { focused?: boolean }).focused ? <FocusRing /> : null}
        </PixelBox>
      )}
    </Pressable>
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
          Ends in {days} days.{FEATURE_GALI_PROGRAM ? ' Top miners by points take the season crown.' : ''}
        </T>
      </Card>
      <T v="label" style={{ marginTop: 6 }}>
        Daily quests · {QUESTS.filter((q) => today && save.questClaimed.includes(q.id)).length}/{QUESTS.length} done · new ones at midnight
      </T>
      {QUESTS.map((q) => {
        const prog = today ? save.questProgress[q.id] ?? 0 : 0;
        const done = prog >= q.target;
        const claimed = today && save.questClaimed.includes(q.id);
        return (
          <Card key={q.id} style={[styles.rowCard, claimed && { opacity: 0.5 }]}>
            <PixIcon name={q.icon} size={26} />
            <View style={{ flex: 1, gap: 5 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <T v="bold" style={{ flexShrink: 1 }}>{q.label}</T>
                <Pill text={q.where} color="rgba(61,224,200,0.16)" fg={COLORS.teal} />
              </View>
              <Bar pct={(prog / q.target) * 100} colors={[COLORS.pink, COLORS.gold]} />
              <T v="muted">
                {Math.min(prog, q.target)}/{q.target} · +{q.rewardXp} XP
              </T>
            </View>
            <Btn small kind={done && !claimed ? 'gold' : 'plain'} label={claimed ? 'Done' : done ? 'Claim' : `${Math.round((Math.min(prog, q.target) / q.target) * 100)}%`} disabled={!done || claimed} onPress={() => claim(q.id)} style={{ minWidth: 84, alignSelf: 'center' }} />
          </Card>
        );
      })}
      <T v="label" style={{ marginTop: 6 }}>
        Achievements
      </T>
      <View style={styles.grid}>
        {ACHIEVEMENTS.map((a) => {
          const got = save.achievements.includes(a.id);
          return (
            <PixelBox key={a.id} fill={got ? 'rgba(255,201,60,0.12)' : 'rgba(9,14,34,0.9)'} hi={got ? COLORS.gold : '#22356f'} lo="#04060f" style={[styles.badge, !got && { opacity: 0.75 }]}>
              <PixIcon name={got ? 'medal' : 'lock'} size={32} />
              <T v="display" style={{ fontSize: 18, lineHeight: 19, color: got ? COLORS.gold : COLORS.text }}>{a.label}</T>
              <T v="muted">{a.desc}</T>
            </PixelBox>
          );
        })}
      </View>
    </>
  );
}


function MotherlodeCard() {
  const owner = useGame((s) => s.wallet.owner);
  const live = useGame(isOnChain);
  // ORE live mode with Gali's own program off: there is no SKR pool on chain
  const noPool = useGame(isLive) && !chainReady;
  const skrPool = useGame((s) => (live ? s.wallet.pool : practiceMotherlode(s.roundId)));
  const orePool = useGame((s) => (live ? s.wallet.orePool : practiceOreMotherlode(s.roundId)));
  const won = useGame((s) => s.wallet.player?.skrWon ?? 0);
  return (
    <Card glow={COLORS.teal}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <PixIcon name="ore" size={18} />
        <T v="label">Two motherlodes, one hit{live ? '' : ' (practice)'}</T>
      </View>
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
            {noPool ? 'SOON' : `${Math.floor(skrPool).toLocaleString()} SKR`}
          </T>
          <T v="muted" style={{ fontSize: 11 }}>
            {noPool ? "GALI'S SKR POOL · NOT LIVE YET" : `GALI'S SKR POOL · ~${usd(skrPool)}`}
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
      <Card glow={COLORS.skr}>
        <T v="display" style={{ fontSize: 22 }}>
          Stake SKR, score harder
        </T>
        <T style={{ marginVertical: 8 }}>Stake SKR in the Gali vault to boost every win: 1.25x at 5,000 SKR (~$90), 1.5x at 50,000 SKR (~$900). Unstake any time.</T>
        <Btn kind="skr" label="Connect wallet" onPress={() => void connect()} />
      </Card>
      <MotherlodeCard />
      </>
    );
  const n = Number(amt) || 0;
  return (
    <>
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
          style={[INPUT, { marginTop: 6, fontFamily: 'Jersey15_400Regular', fontSize: 24, height: 50 }]}
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
      <MotherlodeCard />
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

const hitAgo = (iso: string) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
type HitFilter = 'all' | 'solo' | 'motherlode';
/** Every Gali miner's solo wins and motherlode hits, newest first (recorded by the server from ORE's accounts). */
function BigHits({ owner }: { owner: string | null }) {
  const { hits, status, load } = useOreHits();
  const [f, setF] = useState<HitFilter>('all');
  const [more, setMore] = useState(false);
  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 90_000);
    return () => clearInterval(id);
  }, [load]);
  const solo = hits.filter((h) => h.kind === 'solo');
  const lode = hits.filter((h) => h.kind === 'motherlode');
  const list = f === 'solo' ? solo : f === 'motherlode' ? lode : hits;
  const shown = more ? list : list.slice(0, 8);
  const who = (h: OreHit) => (h.wallet === owner ? 'You' : h.name || short(h.wallet));
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <PixIcon name="trophy" size={20} />
        <T v="label" style={{ flex: 1 }}>
          Gali big hits
        </T>
        <T v="muted" style={{ fontSize: 12 }}>
          {solo.length} solo · {lode.length} motherlode
        </T>
      </View>
      <T v="muted" style={{ marginTop: 4 }}>
        Every round a Gali miner took the whole ORE on a ★ solo spot, and every motherlode they were on the gold spot for.
      </T>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
        <Choice label="All" on={f === 'all'} onPress={() => setF('all')} />
        <Choice label="Solo" on={f === 'solo'} onPress={() => setF('solo')} />
        <Choice label="Motherlode" on={f === 'motherlode'} onPress={() => setF('motherlode')} />
      </View>
      {status === 'loading' && !hits.length ? (
        <T v="muted" style={{ marginTop: 8 }}>
          Loading…
        </T>
      ) : status === 'error' && !hits.length ? (
        <T v="muted" style={{ marginTop: 8 }}>
          Could not load the big hits. Tap Refresh below to try again.
        </T>
      ) : !list.length ? (
        <T v="muted" style={{ marginTop: 8 }}>
          {f === 'motherlode' ? 'No Gali miner has hit a motherlode yet. One round in about 500 pays it.' : f === 'solo' ? 'No solo wins yet.' : 'Nothing yet. The first solo win shows up here.'}
        </T>
      ) : (
        <View style={{ marginTop: 8, gap: 6 }}>
          {shown.map((h) => {
            const mine = h.wallet === owner;
            const lodeHit = h.kind === 'motherlode';
            return (
              <PixelBox key={`${h.roundId}-${h.kind}-${h.wallet}`} fill="rgba(9,14,34,0.9)" hi={mine ? COLORS.gold : lodeHit ? COLORS.teal : '#22356f'} lo="#04060f" style={styles.past}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <PixIcon name={lodeHit ? 'gem' : 'star'} size={18} />
                  <T v="bold" style={{ flex: 1, color: mine ? COLORS.gold : COLORS.text }} numberOfLines={1}>
                    {who(h)}
                  </T>
                  <T v="display" style={{ fontSize: 18, color: lodeHit ? COLORS.teal : COLORS.gold, fontVariant: ['tabular-nums'] }}>
                    {h.ore === null ? '…' : `${fmtOreAmt(h.ore)} ORE`}
                  </T>
                </View>
                <T v="muted" style={styles.hitMeta}>
                  {lodeHit ? `MOTHERLODE${h.share !== null && h.share < 1 ? ` · ${(h.share * 100).toFixed(h.share < 0.01 ? 2 : 1)}% of the gold spot` : ''}` : '★ Solo win'} · #
                  {(h.roundId % 100000).toLocaleString()} · {h.approx ? '~' : ''}
                  {hitAgo(h.at)}
                </T>
                {h.solIn !== null && h.solBack !== null ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, marginTop: 4 }}>
                    <T v="muted" style={{ fontSize: 12 }}>
                      Deployed <T v="display" style={styles.hitNum}>{fmtSol(h.solIn)} SOL</T>
                    </T>
                    <T v="muted" style={{ fontSize: 12 }}>
                      Back after fees{' '}
                      <T v="display" style={styles.hitNum}>
                        {h.solExact ? '' : '~'}
                        {fmtSol(h.solBack)} SOL
                      </T>
                    </T>
                  </View>
                ) : null}
              </PixelBox>
            );
          })}
          {list.length > 8 ? <Btn small label={more ? 'Show fewer' : `Show all ${list.length}`} onPress={() => setMore((m) => !m)} /> : null}
        </View>
      )}
    </Card>
  );
}

function Rounds() {
  const owner = useGame((s) => s.wallet.owner);
  const roundId = useGame((s) => s.roundId);
  const onChain = useGame(isOnChain);
  const [rows, setRows] = useState<BoardRound[] | null>(null);
  const [failed, setFailed] = useState(false);
  const mine = useGame((s) => s.save.history).filter((h) => h.onChain).slice(0, 8);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let live = true;
    setRows(null);
    setFailed(false);
    (onChain ? loadBoard().then((b) => b.fetchPastBoardRounds(roundId)) : Promise.resolve(practiceRounds(roundId, 12)))
      .then((r) => live && setRows(r))
      .catch(() => {
        if (!live) return;
        setFailed(true);
        setRows([]);
      });
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
      {onChain ? <BigHits owner={owner} /> : null}
      <View style={[styles.rowCard, { justifyContent: 'space-between' }]}>
        <T v="display" style={{ fontSize: 20 }}>
          Past rounds{onChain ? '' : ' · practice'}
        </T>
        <Btn small label="Refresh" onPress={() => { setAt(Date.now()); void useOreHits.getState().load(true); }} />
      </View>
      {rows === null ? (
        <Card>
          <T>Loading rounds…</T>
        </Card>
      ) : !rows.length ? (
        <>
          <Card>
            <T>{failed ? 'Could not read past rounds from the network. Tap Refresh to try again.' : 'No finished rounds yet. They show up here once they are settled.'}</T>
          </Card>
          {mine.length ? (
            <Card>
              <T v="label">Your recent rounds</T>
              {mine.map((h) => (
                <T key={h.roundId} v="muted" style={{ marginTop: 4 }}>
                  #{(h.roundId % 100000).toLocaleString()} · spot {h.winning + 1} · {h.won ? 'you won' : 'no strike'} · {fmtSol(h.solIn)} SOL in
                </T>
              ))}
            </Card>
          ) : null}
        </>
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
            <PixelBox key={r.roundId} fill="rgba(9,14,34,0.9)" hi={p.winner && p.winner === owner ? COLORS.gold : p.motherlode ? COLORS.teal : '#22356f'} lo="#04060f" style={styles.past}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <T v="bold">
                  #{(r.roundId % 100000).toLocaleString()} · spot {win + 1}
                  {p.motherlode ? '  · MOTHERLODE' : ''}
                </T>
                <T v="muted" style={{ fontSize: 11 }}>
                  {p.settled ? `${p.miners} miner${p.miners === 1 ? '' : 's'}` : 'settling'}
                </T>
              </View>
              <T style={{ marginTop: 2, color: p.split || nobody ? COLORS.text : COLORS.gold }}>{who}</T>
              <T v="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {fmtSol(p.total)} SOL in · {fmtSol(p.fees)} fees · {p.oreReward.toFixed(2)} ORE
                {p.motherlodeOre > 0 ? ` + ${p.motherlodeOre.toFixed(2)} motherlode` : ''}
              </T>
            </PixelBox>
          );
        })
      )}
    </>
  );
}

type RankTab = 'level' | 'ore' | 'brawl' | 'clans';
function Ranks() {
  const owner = useGame((s) => s.wallet.owner);
  const points = usePoints();
  const xp = useLevelXp();
  const [tab, setTab] = useState<RankTab>('level');
  const miners = useMinerRanks();
  const brawl = useRanks();
  const [period, setPeriod] = useState<Period>(() => useMinerRanks.getState().period);
  useEffect(() => {
    void useMinerRanks.getState().load(period, oreLive ? (w) => loadBoard().then((b) => b.fetchMinerLifetimes(w)) : undefined);
    void useRanks.getState().load(period);
  }, [period]);
  const rows =
    tab === 'ore'
      ? miners.everyone.filter((r) => (r.oreGain ?? 0) > 0).sort((a, b) => (b.oreGain ?? 0) - (a.oreGain ?? 0))
      : [...miners.rows].sort((a, b) => b.gain - a.gain);
  const status = tab === 'brawl' ? brawl.status : miners.status;
  const when = PERIOD_WORDS[period];
  // the server has no period boards yet: say so, and show all time
  const fallback = tab !== 'brawl' && miners.allOnly && period !== 'all';
  const shownPeriod: Period = tab !== 'brawl' && miners.allOnly ? 'all' : period;
  return (
    <>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {(
          [
            ['level', 'LEVEL'],
            ['ore', 'ORE MINED'],
            ['brawl', 'BRAWL'],
            ['clans', 'CLANS'],
          ] as [RankTab, string][]
        ).map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} style={{ flex: 1 }}>
            <PixelBox fill={tab === k ? 'rgba(255,201,60,0.16)' : 'rgba(9,14,34,0.9)'} hi={tab === k ? COLORS.gold : '#22356f'} lo="#04060f" style={{ paddingVertical: 8, alignItems: 'center' }}>
              <T v="label" style={{ color: tab === k ? COLORS.gold : COLORS.muted }}>
                {label}
              </T>
            </PixelBox>
          </Pressable>
        ))}
      </View>
      {tab === 'clans' ? (
        <ComingSoon icon="users" title="CLAN RANKS" line="Clans ranked by the XP their miners earn, today, this month, this year and all time." />
      ) : (
        <>
          <PeriodPicker period={period} onPick={setPeriod} />
          {fallback ? (
            <T v="bold" style={{ fontSize: 12, color: COLORS.gold }}>
              Today, month and year boards switch on with the next server update. Showing all time for now.
            </T>
          ) : null}
          <T v="muted" style={{ fontSize: 12 }}>
            {tab === 'level'
              ? shownPeriod === 'all'
                ? 'Every Gali miner with a wallet, by XP. You: level ' + levelFromXp(xp) + (FEATURE_GALI_PROGRAM ? ' · ' + points.toLocaleString() + ' pts.' : '.')
                : `XP gained ${when}, by every Gali miner with a wallet. Days start at midnight Malaysia time.`
              : tab === 'ore'
                ? shownPeriod === 'all'
                  ? 'Lifetime ORE mined on ORE, read from each wallet on chain.'
                  : `ORE mined ${when}: the chain's total now, minus where each wallet stood when the ${period} began.`
                : brawl.weekOnly
                  ? 'Brawl, the last 7 days (today, month and year boards switch on with the next server update): 1 point a KO, 3 a match win, 2 a Boss Raid won.'
                  : `Brawl ${when}: 1 point a KO, 3 a match win, 2 a Boss Raid won. A KO counts when the miner who went down reports it.`}
          </T>
          {status === 'off' ? (
            <Card>
              <T>Ranks are not set up on this server yet.</T>
            </Card>
          ) : status === 'error' ? (
            <Card>
              <T>Could not load the ranks. Try again in a moment.</T>
            </Card>
          ) : (status === 'loading' || status === 'idle') && !(tab === 'brawl' ? brawl.rows : miners.rows).length ? (
            <Card>
              <T>Loading the ranks…</T>
            </Card>
          ) : tab === 'brawl' ? (
            !brawl.rows.length ? (
              <Card>
                <T>No fights {when} yet. Be the first on the board.</T>
              </Card>
            ) : (
              brawl.rows.map((r, k) => (
                <PixelBox key={r.name} fill="rgba(9,14,34,0.9)" hi="#22356f" lo="#04060f" style={styles.rank}>
                  <RankNo k={k} />
                  <T v="bold" style={{ flex: 1 }} numberOfLines={1}>
                    {r.name}
                  </T>
                  <T v="muted">
                    {r.kos} KO · {r.wins} W{r.bosses ? ` · ${r.bosses} B` : ''}
                  </T>
                  <T v="display" style={{ color: COLORS.gold, fontSize: 20, minWidth: 54, textAlign: 'right' }}>
                    {r.points}
                  </T>
                </PixelBox>
              ))
            )
          ) : !rows.length ? (
            <Card>
              <T>
                {tab === 'ore' && miners.everyone.some((r) => r.ore === null)
                  ? 'Reading ORE from the chain…'
                  : period === 'all'
                    ? 'Nobody on this board yet. Connect a wallet and play a round.'
                    : `Nobody has gained ${tab === 'ore' ? 'ORE' : 'XP'} ${when} yet. Play a round to get on the board.`}
              </T>
            </Card>
          ) : (
            rows.map((r, k) => (
              <PixelBox key={r.wallet} fill={r.wallet === owner ? 'rgba(255,201,60,0.12)' : 'rgba(9,14,34,0.9)'} hi={r.wallet === owner ? COLORS.gold : '#22356f'} lo="#04060f" style={styles.rank}>
                <RankNo k={k} />
                <View style={{ flex: 1 }}>
                  <T v="bold" numberOfLines={1}>
                    {r.name || short(r.wallet)}
                    {r.wallet === owner ? '  (you)' : ''}
                  </T>
                  {r.name ? (
                    <T v="muted" style={{ fontSize: 11 }}>
                      {short(r.wallet)}
                    </T>
                  ) : null}
                </View>
                <T v="muted">Lv {r.level}</T>
                <T v="display" style={{ color: COLORS.gold, fontSize: 18, minWidth: 84, textAlign: 'right' }}>
                  {tab === 'ore' ? `${shownPeriod === 'all' ? '' : '+'}${(r.oreGain ?? 0).toFixed(2)}` : `${shownPeriod === 'all' ? '' : '+'}${r.gain.toLocaleString()}`}
                </T>
                <T v="muted" style={{ fontSize: 10, width: 26 }}>
                  {tab === 'ore' ? 'ORE' : 'XP'}
                </T>
              </PixelBox>
            ))
          )}
        </>
      )}
    </>
  );
}
function RankNo({ k }: { k: number }) {
  return <View style={{ width: 34, alignItems: 'center' }}>{k < 3 ? <PixIcon name={(['medal', 'medal2', 'medal3'] as const)[k]} size={28} /> : <T v="display" style={{ fontSize: 22 }}>{k + 1}</T>}</View>;
}

/** Android only: play sideways (landscape, the default) or upright (portrait). Switching restarts the app. */
function ScreenSwitch() {
  const [busy, setBusy] = useState(false);
  if (Platform.OS !== 'android') return null;
  const cur: Orient = (globalThis as { __GALI_ORIENT?: Orient }).__GALI_ORIENT === 'portrait' ? 'portrait' : 'landscape';
  const pick = async (o: Orient) => {
    if (o === cur || busy) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem(ORIENT_KEY, o);
      // turn the screen now, then restart so the layout is rebuilt for the new shape
      await lockScreen(o);
      await reloadAppAsync('screen orientation changed');
    } catch {
      useGame.getState().toast('Saved. Close and reopen Gali to switch the screen.', 'info');
      setBusy(false);
    }
  };
  return (
    <Card>
      <T>Screen</T>
      <T v="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        Play sideways or upright. Gali restarts to switch, in a second or two.
      </T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Choice label="Landscape" sub="Sideways, two thumbs" on={cur === 'landscape'} onPress={() => void pick('landscape')} disabled={busy} />
        <Choice label="Portrait" sub="Upright, one hand" on={cur === 'portrait'} onPress={() => void pick('portrait')} disabled={busy} />
      </View>
    </Card>
  );
}

/** Brawl on or off. Off: no HP bar, nobody can hit you, and you can't swing at anyone. */
function BrawlSwitch() {
  const off = useBrawl((b) => b.off);
  return (
    <Card style={styles.rowCard}>
      <View style={{ flex: 1 }}>
        <T>Brawl</T>
        <T v="muted" style={{ fontSize: 12 }}>
          Fights in the lobby and on the island. Free, for XP only. Nothing real is lost.
        </T>
      </View>
      <PixIcon name="fist" size={22} />
      <PixSwitch value={!off} onChange={(v: boolean) => useBrawl.getState().setOff(!v)} label="Brawl" />
    </Card>
  );
}

function Me() {
  const w = useGame((s) => s.wallet);
  const save = useGame((s) => s.save);
  const live = useGame(isLive);
  const { connect, disconnect, airdrop, setMute, setMusicOff, setAutoPopBig, refreshWallet, sweepSession } = useGame.getState();
  return (
    <>
      <Card>
        <T v="label">Wallet</T>
        {w.owner ? (
          <>
            <T v="bold" style={{ marginTop: 4 }}>
              {short(w.owner)} · {w.sol.toFixed(3)} SOL · {live ? `${fmtOreAmt(w.ore)} ORE` : `${w.skr.toLocaleString()} SKR`}
            </T>
            {chainReady ? (
              <T v="muted" style={{ marginTop: 4 }}>
                Session key: {w.sessionSol.toFixed(3)} SOL to deploy
                {w.player?.sessionExpires ? ` · expires ${new Date(w.player.sessionExpires * 1000).toLocaleString()}` : ''}
              </T>
            ) : (
              <T v="muted" style={{ marginTop: 4 }}>
                LIVE on Solana mainnet. Every deploy and claim is signed by your wallet.
              </T>
            )}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Btn small label="Refresh" onPress={() => void refreshWallet()} />
              {w.sessionSol > 0.001 ? <Btn small label="Return session SOL" onPress={() => void sweepSession()} /> : null}
              {CLUSTER === 'devnet' ? <Btn small label="+1 devnet SOL" onPress={() => void airdrop()} /> : null}
              <Btn small kind="ghost" label="Disconnect" onPress={() => void disconnect()} />
            </View>
          </>
        ) : (
          <>
            <T style={{ marginVertical: 6 }}>Connect a Solana wallet (Seed Vault on Seeker) to mine ORE on-chain with SOL and climb the leaderboard{FEATURE_GALI_PROGRAM ? ', stake SKR and buy gear' : ''}.</T>
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
          <PixelBox key={k} fill="rgba(9,14,34,0.9)" hi="#22356f" lo="#04060f" style={styles.badge}>
            <T v="display" style={{ fontSize: 30, lineHeight: 32, color: COLORS.gold }}>
              {v}
            </T>
            <T v="label" style={{ fontSize: 13 }}>{k}</T>
          </PixelBox>
        ))}
      </View>
      <BrawlSwitch />
      <ScreenSwitch />
      <Card style={styles.rowCard}>
        <T style={{ flex: 1 }}>Mute sound</T>
        <PixIcon name={save.muted ? 'mute' : 'sound'} size={22} />
        <PixSwitch value={save.muted} onChange={setMute} label="Mute sound" />
      </Card>
      <Card style={styles.rowCard}>
        <T style={{ flex: 1 }}>Music off</T>
        <PixIcon name={save.musicOff ? 'mute' : 'note'} size={22} />
        <PixSwitch value={Boolean(save.musicOff)} onChange={setMusicOff} label="Music off" />
      </Card>
      <Card style={styles.rowCard}>
        <T style={{ flex: 1 }}>Big pop-up for every autopilot round</T>
        <PixIcon name="bot" size={22} />
        <PixSwitch value={Boolean(save.autoPopBig)} onChange={setAutoPopBig} label="Big pop-up for every autopilot round" />
      </Card>
      {live ? (
        <T v="muted">
          Live mode: real rounds on ORE&apos;s mainnet board, about every 80 seconds. Put SOL on 1 to 25 spots and one strikes gold. ORE keeps 1% of every spot and 10% more of spots that miss; the rest comes back for you to claim. The gold spot mines the round&apos;s ORE, split by SOL there, or all to one miner on a solo spot. Gali never holds your SOL. ORE is credited as the board Gali plays on; Gali is not affiliated with or endorsed by ORE. This is a game of chance with real money: 18+ only, and only play with SOL you can afford to lose.
        </T>
      ) : (
      <T v="muted">How it works: each minute is a round on an island with 25 mining spots. Put SOL on 1 to 25 spots. One spot strikes gold. ORE keeps 1% of every spot and 10% more of spots that miss; the rest of your SOL comes back to claim. The gold spot mines the round's ORE, split by SOL there, or on one of the round's 10 solo spots (★) taken whole by one miner, with odds equal to their share. Fewer spots pay more points: 1,000 for a single spot, 40 for all 25. A 1-in-500 motherlode pays out the whole SKR Motherlode Pool on top. Everything lands in Unclaimed until you claim it. This is a game of chance: only play with SOL you can afford to lose.</T>
      )}
      {chainReady ? (
        <Pressable onPress={() => Linking.openURL(`https://explorer.solana.com/address/${PROGRAM_ID_STR}?cluster=${CLUSTER}`)}>
          <T v="muted" style={{ textDecorationLine: 'underline' }}>
            Program {short(PROGRAM_ID_STR)} on Solana Explorer
          </T>
        </Pressable>
      ) : live ? (
        <Pressable onPress={() => Linking.openURL(`https://explorer.solana.com/address/${ORE_PROGRAM_STR}`)}>
          <T v="muted" style={{ textDecorationLine: 'underline' }}>
            ORE program {short(ORE_PROGRAM_STR)} on Solana Explorer
          </T>
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(4,6,15,0.35)' },
  deskScrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(4,6,15,0.45)' },
  deskSheet: { position: 'absolute', top: GUTTER, bottom: GUTTER },
  sheet: { maxHeight: '82%', paddingTop: 4 },
  sheetBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(15,23,52,0.97)' },
  sheetEdge: { position: 'absolute', left: 0, right: 0, top: 0, height: U, backgroundColor: '#04060f' },
  sheetHi: { position: 'absolute', left: 0, right: 0, top: U, height: U, backgroundColor: COLORS.trim },
  grabber: { alignSelf: 'center', width: 40, height: U * 2, backgroundColor: '#3a5290', marginTop: 8, marginBottom: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6, paddingBottom: 10, borderBottomColor: '#22356f', borderBottomWidth: U },
  past: { padding: 12 },
  hitMeta: { fontFamily: 'Jersey15_400Regular', fontSize: 14, lineHeight: 16, marginTop: 3, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
  hitNum: { fontSize: 15, lineHeight: 16, color: COLORS.text, fontVariant: ['tabular-nums'] },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '48.5%', padding: 12, gap: 4 },
  rank: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  switch: { width: 50, height: 28 },
  knob: { position: 'absolute', top: 4, width: 22, height: 20 },
});
