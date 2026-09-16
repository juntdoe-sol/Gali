import { useWallet, type AnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { GEAR, MOTHERLODE_ODDS, SKR_USD } from '../../app/src/game/constants';
import type { Data, Notice, Run } from './App';
import {
  acceptAuthority,
  explorerAddr,
  fundPool,
  proposeAuthority,
  revealAndSettle,
  setPaused,
  short,
  updateConfig,
  walletSkr,
  withdrawTreasury,
  type Config,
  type ConfigChange,
} from './chain';
import { chatAdmin, chatReady, type ChatRow, type MutedRow } from './chatAdmin';

/* ---------------- small building blocks ---------------- */
const fmt = (v: number, dp = 2) => v.toLocaleString(undefined, { maximumFractionDigits: dp });
const usdSkr = (skr: number) => `≈ $${fmt(skr * SKR_USD, 0)}`;

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'gold' | 'sol' | 'skr' | 'bad' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="label">{label}</span>
      <b>{value}</b>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </section>
  );
}

const Addr = ({ a }: { a: string }) => (
  <a className="mono" href={explorerAddr(a)} target="_blank" rel="noreferrer" title={a}>
    {short(a)}
  </a>
);

const today = () => Math.floor(Date.now() / 86_400_000);

/* ---------------- Overview ---------------- */
export function OverviewTab({ d }: { d: Data }) {
  const { cfg, bal, pots, players } = d;
  const s = useMemo(() => {
    const dayStart = Math.floor((today() * 86_400) / cfg.roundSecs);
    const todayPots = pots.filter((p) => p.roundId >= dayStart);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    return {
      feesAll: sum(pots.map((p) => p.feeSol)),
      feesToday: sum(todayPots.map((p) => p.feeSol)),
      solToday: sum(todayPots.map((p) => p.totalSol)),
      solAll: sum(pots.map((p) => p.totalSol)),
      roundsToday: todayPots.length,
      activeToday: players.filter((p) => p.day === today()).length,
      unsettled: pots.filter((p) => !p.settled).length,
      skrPaid: sum(pots.map((p) => p.skrReward)),
      motherlodes: pots.filter((p) => p.motherlode).length,
    };
  }, [cfg, pots, players]);
  const daysLeft = cfg.roundRewardSkr > 0 ? bal.rewards / (cfg.roundRewardSkr * (86_400 / cfg.roundSecs)) : Infinity;

  return (
    <>
      <div className="grid">
        <Stat label="SOL fees earned" value={`${fmt(s.feesAll, 4)} SOL`} sub={`${fmt(s.feesToday, 4)} today`} tone="sol" />
        <Stat label="Treasury SKR" value={`${fmt(bal.treasury)} SKR`} sub={usdSkr(bal.treasury)} tone="gold" />
        <Stat label="Admin wallet" value={`${fmt(bal.authoritySol, 3)} SOL`} sub={<Addr a={cfg.authority} />} />
        <Stat label="Status" value={cfg.paused ? 'Paused' : 'Live'} sub={cfg.paused ? 'New deploys are blocked' : `${cfg.roundSecs}s rounds`} tone={cfg.paused ? 'bad' : undefined} />
      </div>
      <div className="grid">
        <Stat
          label="Rewards Pool"
          value={`${fmt(bal.rewards)} SKR`}
          sub={Number.isFinite(daysLeft) ? `lasts ${fmt(daysLeft, 1)} days at ${fmt(cfg.roundRewardSkr)} SKR/round` : 'round reward is off'}
          tone={daysLeft < 7 ? 'bad' : 'skr'}
        />
        <Stat label="Motherlode Pool" value={`${fmt(bal.motherlode)} SKR`} sub={`${fmt(cfg.motherlodeSkr)} SKR per motherlode (1 in ${MOTHERLODE_ODDS})`} tone="skr" />
        <Stat label="Unclaimed SKR (escrow)" value={`${fmt(bal.potEscrow)} SKR`} sub="won, waiting for claims" />
        <Stat label="Staked by players" value={`${fmt(bal.staked)} SKR`} sub="players can always unstake" />
      </div>
      <div className="grid">
        <Stat label="Players" value={fmt(players.length, 0)} sub={`${s.activeToday} played today`} />
        <Stat label="SOL deployed" value={`${fmt(s.solToday, 3)} today`} sub={`${fmt(s.solAll, 3)} all time`} tone="sol" />
        <Stat label="Rounds with SOL" value={`${fmt(s.roundsToday, 0)} today`} sub={`${fmt(pots.length, 0)} all time · ${s.motherlodes} motherlodes`} />
        <Stat
          label="Needs settling"
          value={fmt(s.unsettled, 0)}
          sub={s.unsettled > 3 ? 'Is the crank running? See Rounds' : 'rounds waiting for settle_pot'}
          tone={s.unsettled > 3 ? 'bad' : undefined}
        />
      </div>
      <p className="hint">SKR is shown at ≈ ${SKR_USD} each. {fmt(s.skrPaid)} SKR has been paid to round winners so far.</p>
    </>
  );
}

/* ---------------- Money ---------------- */
export function MoneyTab({ d, wallet, isAdmin, run }: { d: Data; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const { cfg, bal } = d;
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [fund, setFund] = useState({ pool: 'rewards' as 'rewards' | 'motherlode', amount: '' });
  const [mySkr, setMySkr] = useState<number | null>(null);

  useEffect(() => {
    if (wallet) void walletSkr(cfg, wallet.publicKey).then(setMySkr);
    else setMySkr(null);
  }, [wallet, cfg, d.loadedAt]);

  const destKey = (() => {
    try {
      return new PublicKey((dest || wallet?.publicKey.toBase58() || '').trim());
    } catch {
      return null;
    }
  })();
  const n = Number(amount);
  const canWithdraw = isAdmin && wallet && destKey && n > 0 && n <= bal.treasury;
  const f = Number(fund.amount);

  return (
    <div className="two">
      <Card title="Withdraw treasury SKR" hint="Your 30% of every gear sale collects here. Only the admin wallet can move it, and only from the treasury.">
        <p className="big gold">{fmt(bal.treasury)} SKR</p>
        <label>
          Amount
          <div className="row">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            <button className="ghost" onClick={() => setAmount(String(bal.treasury))}>
              All
            </button>
          </div>
        </label>
        <label>
          Send to wallet
          <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={wallet ? `${wallet.publicKey.toBase58()} (you)` : 'Wallet address'} />
        </label>
        {dest && !destKey ? <p className="warn">That isn't a Solana address.</p> : null}
        <button disabled={!canWithdraw} onClick={() => void run(`Withdraw ${fmt(n)} SKR`, () => withdrawTreasury(wallet!, cfg, destKey!, n)).then((ok) => ok && setAmount(''))}>
          Withdraw {n > 0 ? `${fmt(n)} SKR` : ''}
        </button>
        {!isAdmin ? <p className="hint">Connect the admin wallet to withdraw.</p> : null}
      </Card>

      <Card title="Top up a pool" hint="Anyone can add SKR. The Rewards Pool pays the per-round SKR; the Motherlode Pool pays motherlodes.">
        <div className="seg">
          {(['rewards', 'motherlode'] as const).map((p) => (
            <button key={p} className={fund.pool === p ? 'on' : ''} onClick={() => setFund({ ...fund, pool: p })}>
              {p === 'rewards' ? `Rewards · ${fmt(bal.rewards, 0)}` : `Motherlode · ${fmt(bal.motherlode, 0)}`}
            </button>
          ))}
        </div>
        <label>
          Amount of SKR {mySkr !== null ? <span className="hint">you have {fmt(mySkr)}</span> : null}
          <input inputMode="decimal" value={fund.amount} onChange={(e) => setFund({ ...fund, amount: e.target.value })} placeholder="0" />
        </label>
        <button
          disabled={!wallet || !(f > 0) || (mySkr !== null && f > mySkr)}
          onClick={() => void run(`Add ${fmt(f)} SKR to the ${fund.pool} pool`, () => fundPool(wallet!, cfg, fund.pool, f)).then((ok) => ok && setFund({ ...fund, amount: '' }))}
        >
          Add to {fund.pool === 'rewards' ? 'Rewards' : 'Motherlode'} Pool
        </button>
        <p className="hint">
          Pools can't be withdrawn by anyone, including you. Only add what you want players to win.
        </p>
      </Card>

      <Card title="Where the money goes">
        <table>
          <tbody>
            <tr>
              <td>SOL pot fee</td>
              <td className="num">{cfg.potFeeBps / 100}%</td>
              <td>paid straight to the admin wallet when a round settles</td>
            </tr>
            <tr>
              <td>Gear sales → Motherlode</td>
              <td className="num">{cfg.motherlodePoolBps / 100}%</td>
              <td>pays motherlode winners</td>
            </tr>
            <tr>
              <td>Gear sales → Rewards</td>
              <td className="num">{cfg.rewardsPoolBps / 100}%</td>
              <td>pays {fmt(cfg.roundRewardSkr)} SKR a round to winners</td>
            </tr>
            <tr>
              <td>Gear sales → Treasury</td>
              <td className="num">{(10_000 - cfg.motherlodePoolBps - cfg.rewardsPoolBps) / 100}%</td>
              <td>withdrawable above</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ---------------- Settings ---------------- */
type Form = Record<keyof Omit<ConfigChange, 'gearPricesSkr'>, string>;
const toForm = (c: Config): Form => ({
  potFeePct: String(c.potFeeBps / 100),
  motherlodePoolPct: String(c.motherlodePoolBps / 100),
  rewardsPoolPct: String(c.rewardsPoolBps / 100),
  minDeploySol: String(c.minDeploySol),
  roundRewardSkr: String(c.roundRewardSkr),
  motherlodeSkr: String(c.motherlodeSkr),
  basePoints: String(c.basePoints),
  motherlodePoints: String(c.motherlodePoints),
  boostTier1Skr: String(c.boostTier1Skr),
  boostTier2Skr: String(c.boostTier2Skr),
});
const FIELDS: { key: keyof Form; label: string; unit: string; hint: string }[] = [
  { key: 'potFeePct', label: 'SOL pot fee', unit: '%', hint: 'Max 20%. Applies when a round settles.' },
  { key: 'roundRewardSkr', label: 'SKR mined per round', unit: 'SKR', hint: 'Each round: 50/50 split by SOL on the gold block, or all to one lucky winner.' },
  { key: 'motherlodeSkr', label: 'Motherlode payout', unit: 'SKR', hint: 'Shared the same way on a 1-in-625 round.' },
  { key: 'minDeploySol', label: 'Minimum per block', unit: 'SOL', hint: 'Smallest deploy allowed on one block.' },
  { key: 'motherlodePoolPct', label: 'Gear sales to Motherlode', unit: '%', hint: 'Motherlode + Rewards can be at most 100%.' },
  { key: 'rewardsPoolPct', label: 'Gear sales to Rewards', unit: '%', hint: 'The rest of each sale goes to the treasury.' },
  { key: 'basePoints', label: 'Base points', unit: 'pts', hint: 'A win pays this × 25 / blocks covered.' },
  { key: 'motherlodePoints', label: 'Motherlode bonus', unit: 'pts', hint: 'Added before the stake boost.' },
  { key: 'boostTier1Skr', label: '1.25x boost at', unit: 'SKR staked', hint: '' },
  { key: 'boostTier2Skr', label: '1.5x boost at', unit: 'SKR staked', hint: 'Must be at least the 1.25x level.' },
];

export function SettingsTab({ d, wallet, isAdmin, isPending, run }: { d: Data; wallet?: AnchorWallet; isAdmin: boolean; isPending: boolean; run: Run }) {
  const { cfg } = d;
  const [form, setForm] = useState<Form>(() => toForm(cfg));
  const [prices, setPrices] = useState<string[]>(() => cfg.gearPricesSkr.map(String));
  const [nextAdmin, setNextAdmin] = useState('');
  const [confirmPause, setConfirmPause] = useState(false);

  // reset the form when the on-chain config changes
  const cfgKey = JSON.stringify(cfg, (_, v) => (v instanceof PublicKey ? v.toBase58() : v));
  useEffect(() => {
    setForm(toForm(cfg));
    setPrices(cfg.gearPricesSkr.map(String));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey]);

  const base = toForm(cfg);
  const change: ConfigChange = {};
  const errors: string[] = [];
  for (const f of FIELDS) {
    if (form[f.key] === base[f.key]) continue;
    const v = Number(form[f.key]);
    if (form[f.key].trim() === '' || !Number.isFinite(v) || v < 0) errors.push(`${f.label} must be a number ≥ 0`);
    else change[f.key] = v;
  }
  const pricesChanged = prices.some((p, i) => p !== String(cfg.gearPricesSkr[i]));
  if (pricesChanged) {
    const nums = prices.map(Number);
    if (nums.some((v, i) => prices[i].trim() === '' || !Number.isFinite(v) || v < 0)) errors.push('Gear prices must be numbers ≥ 0');
    else change.gearPricesSkr = nums;
  }
  const fee = Number(form.potFeePct);
  if (fee > 20) errors.push('SOL pot fee can be at most 20%');
  if (Number(form.motherlodePoolPct) + Number(form.rewardsPoolPct) > 100) errors.push('Motherlode + Rewards shares can be at most 100%');
  if (Number(form.minDeploySol) <= 0) errors.push('Minimum per block must be above 0');
  if (Number(form.boostTier2Skr) > 0 && Number(form.boostTier2Skr) < Number(form.boostTier1Skr)) errors.push('The 1.5x level must be at least the 1.25x level');
  const changed = Object.keys(change).length;

  let nextKey: PublicKey | null = null;
  try {
    nextKey = nextAdmin.trim() ? new PublicKey(nextAdmin.trim()) : null;
  } catch {
    nextKey = null;
  }

  return (
    <div className="two">
      <Card title="Game settings" hint="Only the fields you change are sent. Round length and the SKR mint are fixed.">
        <div className="fields">
          {FIELDS.map((f) => (
            <label key={f.key} className={form[f.key] !== base[f.key] ? 'dirty' : ''}>
              <span>
                {f.label} <em>{f.unit}</em>
              </span>
              <input inputMode="decimal" value={form[f.key]} disabled={!isAdmin} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              {f.hint ? <small>{f.hint}</small> : null}
            </label>
          ))}
        </div>
        <details>
          <summary>Gear prices ({cfg.gearPricesSkr.length} items)</summary>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Item</th>
                <th>SKR</th>
                <th>≈ USD</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((p, i) => (
                <tr key={i} className={p !== String(cfg.gearPricesSkr[i]) ? 'dirty' : ''}>
                  <td className="num">{i}</td>
                  <td>{GEAR.find((g) => g.id === i)?.name ?? `Item ${i}`}</td>
                  <td>
                    <input inputMode="decimal" value={p} disabled={!isAdmin} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? e.target.value : x)))} />
                  </td>
                  <td className="num">${fmt(Number(p) * SKR_USD, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        {errors.length ? (
          <ul className="warn">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <button disabled={!isAdmin || !changed || errors.length > 0} onClick={() => void run(`Save ${changed} setting${changed > 1 ? 's' : ''}`, () => updateConfig(wallet!, cfg, change))}>
            Save {changed ? `${changed} change${changed > 1 ? 's' : ''}` : 'changes'}
          </button>
          <button
            className="ghost"
            disabled={!changed}
            onClick={() => {
              setForm(toForm(cfg));
              setPrices(cfg.gearPricesSkr.map(String));
            }}
          >
            Reset
          </button>
        </div>
      </Card>

      <div className="stack">
        <Card
          title={cfg.paused ? 'Gali is paused' : 'Pause Gali'}
          hint="Pausing blocks new deploys and gear sales. Reveals, settlements, claims and unstaking keep working, so players can always get paid."
        >
          {cfg.paused ? (
            <button disabled={!isAdmin} onClick={() => void run('Resume Gali', () => setPaused(wallet!, false))}>
              Resume Gali
            </button>
          ) : confirmPause ? (
            <div className="row">
              <button
                className="danger"
                disabled={!isAdmin}
                onClick={() => void run('Pause Gali', () => setPaused(wallet!, true)).then(() => setConfirmPause(false))}
              >
                Yes, pause now
              </button>
              <button className="ghost" onClick={() => setConfirmPause(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="danger" disabled={!isAdmin} onClick={() => setConfirmPause(true)}>
              Pause Gali…
            </button>
          )}
        </Card>

        <Card
          title="Admin wallet"
          hint="Handing over is two steps: this wallet proposes, the new wallet accepts. The SOL fee and all admin rights move with it. Use a multisig for launch."
        >
          <p>
            Current: <Addr a={cfg.authority} />
            {cfg.pendingAuthority ? (
              <>
                {' '}
                · proposed: <Addr a={cfg.pendingAuthority} />
              </>
            ) : null}
          </p>
          {isPending ? (
            <button onClick={() => void run('Accept admin role', () => acceptAuthority(wallet!))}>Accept admin role</button>
          ) : (
            <>
              <label>
                New admin wallet
                <input value={nextAdmin} disabled={!isAdmin} onChange={(e) => setNextAdmin(e.target.value)} placeholder="Wallet or multisig address" />
              </label>
              {nextAdmin && !nextKey ? <p className="warn">That isn't a Solana address.</p> : null}
              <div className="row">
                <button disabled={!isAdmin || !nextKey} onClick={() => void run('Propose new admin', () => proposeAuthority(wallet!, nextKey!)).then((ok) => ok && setNextAdmin(''))}>
                  Propose
                </button>
                {cfg.pendingAuthority ? (
                  <button className="ghost" disabled={!isAdmin} onClick={() => void run('Cancel hand-over', () => proposeAuthority(wallet!, PublicKey.default))}>
                    Cancel proposal
                  </button>
                ) : null}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Rounds ---------------- */
export function RoundsTab({ d, wallet, run }: { d: Data; wallet?: AnchorWallet; run: Run }) {
  const { cfg, pots } = d;
  const current = Math.floor(Date.now() / 1000 / cfg.roundSecs);
  const waiting = pots.filter((p) => !p.settled && p.roundId < current);
  const [busy, setBusy] = useState<number | null>(null);
  const settle = async (r: number) => {
    setBusy(r);
    await run(`Settle round ${r}`, () => revealAndSettle(wallet!, cfg, r));
    setBusy(null);
  };
  return (
    <>
      <Card
        title={`Waiting to settle (${waiting.length})`}
        hint="Finished rounds whose pot hasn't been settled. The crank (npm run crank) does this every minute. Anyone can settle; the SOL fee still goes to the admin wallet."
      >
        {waiting.length ? (
          <table>
            <thead>
              <tr>
                <th>Round</th>
                <th>Ended</th>
                <th>Pot</th>
                <th>Miners</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {waiting.slice(0, 50).map((p) => (
                <tr key={p.roundId}>
                  <td className="num">{p.roundId}</td>
                  <td>{new Date((p.roundId + 1) * cfg.roundSecs * 1000).toLocaleString()}</td>
                  <td className="num">{fmt(p.totalSol, 4)} SOL</td>
                  <td className="num">{p.miners}</td>
                  <td>
                    <button className="small" disabled={!wallet || busy !== null} onClick={() => void settle(p.roundId)}>
                      {busy === p.roundId ? 'Settling…' : 'Settle'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="ok">All finished rounds are settled.</p>
        )}
      </Card>
      <Card title="Recent rounds">
        <table>
          <thead>
            <tr>
              <th>Round</th>
              <th>Pot</th>
              <th>Miners</th>
              <th>Fee</th>
              <th>To winners</th>
              <th>SKR mined</th>
              <th>SKR paid as</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pots.slice(0, 40).map((p) => (
              <tr key={p.roundId}>
                <td className="num">{p.roundId}</td>
                <td className="num">{fmt(p.totalSol, 4)}</td>
                <td className="num">{p.miners}</td>
                <td className="num">{p.settled ? fmt(p.feeSol, 4) : '—'}</td>
                <td className="num">{p.settled ? fmt(p.poolSol, 4) : '—'}</td>
                <td className="num">{p.settled ? fmt(p.skrReward) : '—'}</td>
                <td>{p.settled && p.skrReward > 0 ? (p.splitReward ? 'split' : 'one lucky winner') : '—'}</td>
                <td>
                  {p.roundId >= current ? <span className="tag live">live</span> : p.settled ? (p.poolSol === 0 ? <span className="tag">no winner</span> : <span className="tag ok">settled</span>) : <span className="tag bad">waiting</span>}
                  {p.motherlode ? <span className="tag gold">motherlode</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!pots.length ? <p className="hint">No SOL has been deployed yet.</p> : null}
      </Card>
    </>
  );
}

/* ---------------- Players ---------------- */
export function PlayersTab({ d }: { d: Data }) {
  const [sort, setSort] = useState<'points' | 'solDeployed' | 'solWon' | 'skrMined' | 'rounds'>('points');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => [...d.players].filter((p) => !q || p.owner.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b[sort] - a[sort]),
    [d.players, sort, q],
  );
  const cols: { key: typeof sort; label: string }[] = [
    { key: 'points', label: 'Points' },
    { key: 'rounds', label: 'Rounds' },
    { key: 'solDeployed', label: 'SOL in' },
    { key: 'solWon', label: 'SOL won' },
    { key: 'skrMined', label: 'SKR mined' },
  ];
  return (
    <Card title={`Players (${d.players.length})`}>
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wallet" />
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Wallet</th>
            {cols.map((c) => (
              <th key={c.key}>
                <button className={`sort ${sort === c.key ? 'on' : ''}`} onClick={() => setSort(c.key)}>
                  {c.label}
                  {sort === c.key ? ' ↓' : ''}
                </button>
              </th>
            ))}
            <th>Wins</th>
            <th>Staked</th>
            <th>Streak</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((p, i) => (
            <tr key={p.owner}>
              <td className="num">{i + 1}</td>
              <td>
                <Addr a={p.owner} />
                {p.day === today() ? <span className="tag live">today</span> : null}
              </td>
              <td className="num">{fmt(p.points, 0)}</td>
              <td className="num">{fmt(p.rounds, 0)}</td>
              <td className="num">{fmt(p.solDeployed, 3)}</td>
              <td className="num">{fmt(p.solWon, 3)}</td>
              <td className="num">{fmt(p.skrMined + p.skrWon)}</td>
              <td className="num">{p.wins}</td>
              <td className="num">{fmt(p.stakedSkr, 0)}</td>
              <td className="num">{p.streak}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length ? <p className="hint">No players yet.</p> : null}
    </Card>
  );
}

/* ---------------- Chat ---------------- */
export function ChatTab({ isAdmin, setNotice }: { isAdmin: boolean; setNotice: (n: Notice | null) => void }) {
  const { publicKey, signMessage } = useWallet();
  const [msgs, setMsgs] = useState<ChatRow[] | null>(null);
  const [muted, setMuted] = useState<MutedRow[]>([]);
  const [muteWallet, setMuteWallet] = useState('');
  const [reason, setReason] = useState('');

  if (!chatReady)
    return (
      <Card title="Miners chat" hint="The chat server isn't connected. Deploy the Supabase functions and fill app/src/chain/chat.json (see README).">
        <p>Nothing to moderate yet.</p>
      </Card>
    );
  if (!isAdmin || !publicKey || !signMessage)
    return (
      <Card title="Miners chat" hint="Moderation needs the admin wallet, and a wallet that can sign messages.">
        <p>Connect the admin wallet to load the chat.</p>
      </Card>
    );

  const call = async (label: string, action: 'list' | 'hide' | 'unhide' | 'mute' | 'unmute', target = '', why = '') => {
    setNotice({ tone: 'busy', text: `${label}… sign the message in your wallet` });
    try {
      if (action === 'list') {
        const r = await chatAdmin<{ muted: MutedRow[]; messages: ChatRow[] }>(publicKey.toBase58(), signMessage, 'list');
        setMsgs(r.messages);
        setMuted(r.muted);
      } else {
        await chatAdmin(publicKey.toBase58(), signMessage, action, target, why);
        const r = await chatAdmin<{ muted: MutedRow[]; messages: ChatRow[] }>(publicKey.toBase58(), signMessage, 'list');
        setMsgs(r.messages);
        setMuted(r.muted);
      }
      setNotice({ tone: 'ok', text: `${label}: done` });
    } catch (e) {
      setNotice({ tone: 'err', text: `${label} failed: ${String((e as Error).message ?? e)}` });
    }
  };
  const isMuted = (w: string) => muted.some((m) => m.wallet === w);

  return (
    <div className="two">
      <Card title="Recent messages" hint="Hidden messages disappear for players the next time they open the chat. Each action asks your wallet to sign a message; nothing is sent on-chain.">
        <button onClick={() => void call('Load chat', 'list')}>{msgs ? 'Reload' : 'Load chat'}</button>
        {msgs ? (
          <ul className="msgs">
            {msgs.map((m) => (
              <li key={m.id} className={m.hidden ? 'hidden' : ''}>
                <div className="meta">
                  <Addr a={m.wallet} /> · lvl {m.level} · {new Date(m.created_at).toLocaleString()}
                  {m.kind === 'tip' ? <span className="tag gold">tip {m.tip_amount} SKR</span> : null}
                  {m.hidden ? <span className="tag bad">hidden</span> : null}
                  {isMuted(m.wallet) ? <span className="tag bad">muted</span> : null}
                </div>
                <p>{m.body}</p>
                <div className="row">
                  <button className="small ghost" onClick={() => void call(m.hidden ? 'Unhide message' : 'Hide message', m.hidden ? 'unhide' : 'hide', String(m.id))}>
                    {m.hidden ? 'Unhide' : 'Hide'}
                  </button>
                  {!isMuted(m.wallet) ? (
                    <button className="small danger" onClick={() => void call('Mute wallet', 'mute', m.wallet, `message ${m.id}`)}>
                      Mute {short(m.wallet)}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <Card title={`Muted wallets (${muted.length})`} hint="Muted wallets can still play and send SKR, but can't post.">
        <label>
          Wallet
          <input value={muteWallet} onChange={(e) => setMuteWallet(e.target.value)} placeholder="Wallet address" />
        </label>
        <label>
          Reason (optional)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Spam, scam links…" />
        </label>
        <button
          className="danger"
          disabled={!muteWallet.trim()}
          onClick={() => void call('Mute wallet', 'mute', muteWallet.trim(), reason).then(() => {
            setMuteWallet('');
            setReason('');
          })}
        >
          Mute
        </button>
        <ul className="muted-list">
          {muted.map((m) => (
            <li key={m.wallet}>
              <Addr a={m.wallet} /> {m.reason ? <span className="hint">· {m.reason}</span> : null}
              <button className="small ghost" onClick={() => void call('Unmute wallet', 'unmute', m.wallet)}>
                Unmute
              </button>
            </li>
          ))}
        </ul>
        {msgs && !muted.length ? <p className="hint">Nobody is muted.</p> : null}
      </Card>
    </div>
  );
}
