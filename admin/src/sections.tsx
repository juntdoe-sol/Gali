import { useWallet, type AnchorWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { gearName } from './game';
import type { Data, Notice, Run } from './App';
import {
  acceptAuthority,
  explorerAddr,
  fundMotherlode,
  pda,
  priceAge,
  PROGRAM_ID,
  proposeAuthority,
  setPaused,
  setTokenPrices,
  short,
  TOKENS,
  updateConfig,
  walletBalance,
  withdrawTreasury,
  type Config,
  type ConfigChange,
  type Token,
} from './chain';
import { chatAdmin, chatReady, type ChatRow, type MutedRow } from './chatAdmin';

/* ---------------- small building blocks ---------------- */
const fmt = (v: number, dp = 2) => v.toLocaleString(undefined, { maximumFractionDigits: dp });
/** ORE is worth far more per unit than SKR, so it needs more decimals to be readable. */
const amount = (v: number, t: Token) => `${fmt(v, t === 'ORE' ? 4 : 2)} ${t}`;
/** Prices are stored to the millionth of a dollar; show that precision below $1. */
const dollars = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: v < 1 ? 6 : 2 })}`;
const tone = (t: Token) => (t === 'SKR' ? 'skr' : 'gold');

function duration(secs: number) {
  if (secs < 120) return `${secs} s`;
  if (secs < 7_200) return `${Math.round(secs / 60)} min`;
  if (secs < 172_800) return `${Math.round(secs / 3_600)} h`;
  return `${Math.round(secs / 86_400)} days`;
}

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

function TokenPicker({ value, onChange, label }: { value: Token; onChange: (t: Token) => void; label: (t: Token) => string }) {
  return (
    <div className="seg">
      {TOKENS.map((t) => (
        <button key={t} className={value === t ? 'on' : ''} onClick={() => onChange(t)}>
          {label(t)}
        </button>
      ))}
    </div>
  );
}

const Addr = ({ a }: { a: string }) => (
  <a className="mono" href={explorerAddr(a)} target="_blank" rel="noreferrer" title={a}>
    {short(a)}
  </a>
);

const today = () => Math.floor(Date.now() / 86_400_000);

/** A wallet address typed into a form, or the connected wallet when the field is empty. */
function parseKey(text: string, fallback?: PublicKey): PublicKey | null {
  try {
    return text.trim() ? new PublicKey(text.trim()) : (fallback ?? null);
  } catch {
    return null;
  }
}

/* ---------------- Overview ---------------- */
export function OverviewTab({ d }: { d: Data }) {
  const { cfg, bal, players } = d;
  const age = priceAge(cfg);
  const s = useMemo(() => {
    const sum = (f: (p: (typeof players)[number]) => number) => players.reduce((a, p) => a + f(p), 0);
    return {
      activeToday: players.filter((p) => p.day === today()).length,
      rounds: sum((p) => p.rounds),
      solDeployed: sum((p) => p.solDeployed),
      skrWon: sum((p) => p.skrWon),
      oreWon: sum((p) => p.oreWon),
    };
  }, [players]);

  return (
    <>
      <div className="grid">
        <Stat
          label="Status"
          value={cfg.paused ? 'Paused' : 'Live'}
          sub={cfg.paused ? 'Gear sales, round recording and jackpot claims are blocked' : 'Gear sales and jackpots are open'}
          tone={cfg.paused ? 'bad' : undefined}
        />
        <Stat
          label="Token prices"
          value={`SKR ${dollars(cfg.priceUsd.SKR)} · ORE ${dollars(cfg.priceUsd.ORE)}`}
          sub={age.stale ? `set ${duration(age.secs)} ago: stale, gear sales are refused` : `set ${duration(age.secs)} ago`}
          tone={age.stale ? 'bad' : undefined}
        />
        <Stat label="Admin wallet" value={`${fmt(bal.authoritySol, 3)} SOL`} sub={<Addr a={cfg.authority} />} />
      </div>
      <div className="grid">
        {TOKENS.map((t) => (
          <Stat
            key={t}
            label={`${t} Motherlode Pool`}
            value={amount(bal.motherlode[t], t)}
            sub={`≈ $${fmt(bal.motherlode[t] * cfg.priceUsd[t])} · paid when ORE's motherlode hits`}
            tone={tone(t)}
          />
        ))}
        {TOKENS.map((t) => (
          <Stat key={t} label={`${t} treasury`} value={amount(bal.treasury[t], t)} sub={`≈ $${fmt(bal.treasury[t] * cfg.priceUsd[t])} · withdraw in Money`} />
        ))}
      </div>
      <div className="grid">
        {TOKENS.map((t) => (
          <Stat key={t} label={`Staked ${t}`} value={amount(bal.staked[t], t)} sub="players can always unstake" />
        ))}
        <Stat label="Players" value={fmt(players.length, 0)} sub={`${s.activeToday} recorded a round today · ${fmt(s.rounds, 0)} rounds, ${fmt(s.solDeployed, 3)} SOL deployed on ORE`} />
        <Stat label="Jackpots paid" value={`${fmt(s.skrWon)} SKR`} sub={`and ${amount(s.oreWon, 'ORE')}`} tone="skr" />
      </div>
      <Card title="Accounts">
        <table>
          <tbody>
            <tr>
              <td>Program</td>
              <td>
                <Addr a={PROGRAM_ID.toBase58()} />
              </td>
            </tr>
            <tr>
              <td>Config</td>
              <td>
                <Addr a={pda.config.toBase58()} />
              </td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>
                <Addr a={cfg.authority} />
                {cfg.pendingAuthority ? (
                  <>
                    {' '}
                    · proposed: <Addr a={cfg.pendingAuthority} />
                  </>
                ) : null}
              </td>
            </tr>
            {TOKENS.map((t) => (
              <tr key={t}>
                <td>{t} mint</td>
                <td>
                  <Addr a={cfg.mint[t].toBase58()} /> <span className="hint">{cfg.decimals[t]} decimals</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ---------------- Money ---------------- */
function WithdrawCard({ d, wallet, isAdmin, run }: { d: Data; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const { cfg, bal } = d;
  const [token, setToken] = useState<Token>('SKR');
  const [value, setValue] = useState('');
  const [dest, setDest] = useState('');
  const destKey = parseKey(dest, wallet?.publicKey);
  const n = Number(value);
  const held = bal.treasury[token];
  const canWithdraw = isAdmin && wallet && destKey && n > 0 && n <= held;

  return (
    <Card title="Withdraw treasury" hint="The treasury share of every gear sale collects here. Only the admin wallet can move it. The motherlode pools and staked tokens can't be withdrawn by anyone.">
      <TokenPicker value={token} onChange={setToken} label={(t) => `${t} · ${amount(bal.treasury[t], t)}`} />
      <p className={`big ${tone(token)}`}>{amount(held, token)}</p>
      <label>
        Amount
        <div className="row">
          <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
          <button className="ghost" onClick={() => setValue(String(held))}>
            All
          </button>
        </div>
      </label>
      <label>
        Send to wallet
        <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder={wallet ? `${wallet.publicKey.toBase58()} (you)` : 'Wallet address'} />
      </label>
      {dest && !destKey ? <p className="warn">That isn't a Solana address.</p> : null}
      <button
        disabled={!canWithdraw}
        onClick={() => void run(`Withdraw ${amount(n, token)}`, () => withdrawTreasury(wallet!, cfg, token, destKey!, n)).then((ok) => ok && setValue(''))}
      >
        Withdraw {n > 0 ? amount(n, token) : ''}
      </button>
      {!isAdmin ? <p className="hint">Connect the admin wallet to withdraw.</p> : null}
    </Card>
  );
}

function FundCard({ d, wallet, run }: { d: Data; wallet?: AnchorWallet; run: Run }) {
  const { cfg, bal } = d;
  const [token, setToken] = useState<Token>('SKR');
  const [value, setValue] = useState('');
  const [mine, setMine] = useState<number | null>(null);

  useEffect(() => {
    setMine(null);
    if (wallet) void walletBalance(cfg, token, wallet.publicKey).then(setMine);
  }, [wallet, cfg, token, d.loadedAt]);

  const n = Number(value);
  return (
    <Card title="Top up a motherlode pool" hint="Anyone can add to either pool. When ORE's motherlode hits, both pools pay out to that round's winning square, split the way ORE split its own motherlode.">
      <TokenPicker value={token} onChange={setToken} label={(t) => `${t} · ${amount(bal.motherlode[t], t)}`} />
      <label>
        Amount of {token} {mine !== null ? <span className="hint">you have {amount(mine, token)}</span> : null}
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
      </label>
      <button
        disabled={!wallet || !(n > 0) || (mine !== null && n > mine)}
        onClick={() => void run(`Add ${amount(n, token)} to the ${token} Motherlode Pool`, () => fundMotherlode(wallet!, cfg, token, n)).then((ok) => ok && setValue(''))}
      >
        Add to the {token} Motherlode Pool
      </button>
      <p className="hint">Pools can't be withdrawn by anyone, including you. Only add what you want players to win.</p>
    </Card>
  );
}

export function MoneyTab({ d, wallet, isAdmin, run }: { d: Data; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const { cfg } = d;
  return (
    <div className="two">
      <WithdrawCard d={d} wallet={wallet} isAdmin={isAdmin} run={run} />
      <FundCard d={d} wallet={wallet} run={run} />
      <Card title="Where gear sales go" hint="Gear is priced in dollars and paid in SKR or ORE at the token prices set in Settings.">
        <table>
          <tbody>
            {TOKENS.flatMap((t) => [
              <tr key={`${t}-pool`}>
                <td>{t} sales to the {t} Motherlode Pool</td>
                <td className="num">{cfg.motherlodeBps[t] / 100}%</td>
                <td>paid out when ORE's motherlode hits</td>
              </tr>,
              <tr key={`${t}-treasury`}>
                <td>{t} sales to the {t} treasury</td>
                <td className="num">{(10_000 - cfg.motherlodeBps[t]) / 100}%</td>
                <td>withdrawable above</td>
              </tr>,
            ])}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function PricesCard({ cfg, wallet, isAdmin, run }: { cfg: Config; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const [skr, setSkr] = useState(String(cfg.priceUsd.SKR));
  const [ore, setOre] = useState(String(cfg.priceUsd.ORE));
  useEffect(() => {
    setSkr(String(cfg.priceUsd.SKR));
    setOre(String(cfg.priceUsd.ORE));
  }, [cfg.priceUsd.SKR, cfg.priceUsd.ORE, cfg.priceUpdatedAt]);

  const age = priceAge(cfg);
  const valid = Number(skr) > 0 && Number(ore) > 0;
  return (
    <Card
      title="Token prices"
      hint="Dollars for one whole token. Gear is priced in dollars, so these rates decide how many tokens an item costs. Neither token has an on-chain price feed; check a live quote before saving."
    >
      <div className="fields">
        <label>
          <span>
            SKR <em>USD</em>
          </span>
          <input inputMode="decimal" value={skr} disabled={!isAdmin} onChange={(e) => setSkr(e.target.value)} />
        </label>
        <label>
          <span>
            ORE <em>USD</em>
          </span>
          <input inputMode="decimal" value={ore} disabled={!isAdmin} onChange={(e) => setOre(e.target.value)} />
        </label>
      </div>
      <p className={age.stale ? 'warn' : 'hint'}>
        Last set {new Date(cfg.priceUpdatedAt * 1000).toLocaleString()} ({duration(age.secs)} ago).{' '}
        {cfg.priceMaxAgeSecs > 0
          ? `Gear sales stop once the prices are ${duration(cfg.priceMaxAgeSecs)} old${age.stale ? ', which they are now' : ''}.`
          : 'No max age is set, so old prices are never refused.'}
      </p>
      {!valid ? <p className="warn">Both prices must be above 0.</p> : null}
      <button disabled={!isAdmin || !valid} onClick={() => void run('Set token prices', () => setTokenPrices(wallet!, Number(skr), Number(ore)))}>
        Set prices
      </button>
    </Card>
  );
}

type Form = Record<keyof Omit<ConfigChange, 'gearPricesUsd'>, string>;
const toForm = (c: Config): Form => ({
  motherlodePct: String(c.motherlodeBps.SKR / 100),
  oreMotherlodePct: String(c.motherlodeBps.ORE / 100),
  basePoints: String(c.basePoints),
  motherlodePoints: String(c.motherlodePoints),
  boostTier1Skr: String(c.boostTier1.SKR),
  boostTier2Skr: String(c.boostTier2.SKR),
  boostTier1Ore: String(c.boostTier1.ORE),
  boostTier2Ore: String(c.boostTier2.ORE),
  priceMaxAgeSecs: String(c.priceMaxAgeSecs),
});
const U32_MAX = 4_294_967_295;
const FIELDS: { key: keyof Form; label: string; unit: string; hint: string; whole?: boolean; max?: number }[] = [
  { key: 'motherlodePct', label: 'SKR sales to the SKR Motherlode', unit: '%', hint: 'The rest goes to the SKR treasury.', max: 100 },
  { key: 'oreMotherlodePct', label: 'ORE sales to the ORE Motherlode', unit: '%', hint: 'The rest goes to the ORE treasury.', max: 100 },
  { key: 'basePoints', label: 'Base points', unit: 'pts', hint: 'A recorded win pays this × 25 / squares covered.', whole: true },
  { key: 'motherlodePoints', label: 'Motherlode bonus', unit: 'pts', hint: "Added to a win when ORE's motherlode hits, before the stake boost.", whole: true },
  { key: 'boostTier1Skr', label: '1.25x boost at', unit: 'SKR staked', hint: '0 turns this tier off.' },
  { key: 'boostTier2Skr', label: '1.5x boost at', unit: 'SKR staked', hint: 'At least the 1.25x level, or 0 for off.' },
  { key: 'boostTier1Ore', label: '1.25x boost at', unit: 'ORE staked', hint: 'The better of the SKR and ORE boosts applies; they do not stack.' },
  { key: 'boostTier2Ore', label: '1.5x boost at', unit: 'ORE staked', hint: 'At least the 1.25x level, or 0 for off.' },
  { key: 'priceMaxAgeSecs', label: 'Price max age', unit: 'seconds', hint: 'Gear sales stop when the token prices are older than this. 0 turns the check off (test validators only).', whole: true, max: U32_MAX },
];

/** The fields that differ from the chain, as a ConfigChange, plus anything that makes them invalid. */
function diffConfig(cfg: Config, form: Form, prices: string[]) {
  const base = toForm(cfg);
  const change: ConfigChange = {};
  const errors: string[] = [];
  for (const f of FIELDS) {
    if (form[f.key] === base[f.key]) continue;
    const v = Number(form[f.key]);
    if (form[f.key].trim() === '' || !Number.isFinite(v) || v < 0) errors.push(`${f.label} must be a number ≥ 0`);
    else if (f.whole && !Number.isInteger(v)) errors.push(`${f.label} must be a whole number`);
    else if (f.max !== undefined && v > f.max) errors.push(`${f.label} can be at most ${fmt(f.max, 0)}`);
    else change[f.key] = v;
  }
  if (prices.some((p, i) => p !== String(cfg.gearPricesUsd[i]))) {
    const nums = prices.map(Number);
    if (nums.some((v, i) => prices[i].trim() === '' || !Number.isFinite(v) || v < 0)) errors.push('Gear prices must be numbers ≥ 0');
    else change.gearPricesUsd = nums;
  }
  for (const t of TOKENS) {
    const t1 = Number(form[`boostTier1${t === 'SKR' ? 'Skr' : 'Ore'}`]);
    const t2 = Number(form[`boostTier2${t === 'SKR' ? 'Skr' : 'Ore'}`]);
    if (t2 > 0 && t2 < t1) errors.push(`The 1.5x ${t} level must be at least the 1.25x level`);
  }
  return { change, errors, dirty: (k: keyof Form) => form[k] !== base[k] };
}

function GearPrices({ cfg, prices, setPrices, isAdmin }: { cfg: Config; prices: string[]; setPrices: (p: string[]) => void; isAdmin: boolean }) {
  const inToken = (usd: number, t: Token) => (usd > 0 && cfg.priceUsd[t] > 0 ? amount(usd / cfg.priceUsd[t], t) : '-');
  return (
    <details>
      <summary>Gear prices ({cfg.gearPricesUsd.length} items)</summary>
      <p className="hint">In dollars. 0 means the item can't be bought. Token amounts use the current token prices.</p>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item</th>
            <th>USD</th>
            <th>≈ SKR</th>
            <th>≈ ORE</th>
          </tr>
        </thead>
        <tbody>
          {prices.map((p, i) => (
            <tr key={i} className={p !== String(cfg.gearPricesUsd[i]) ? 'dirty' : ''}>
              <td className="num">{i}</td>
              <td>{gearName(i)}</td>
              <td>
                <input inputMode="decimal" value={p} disabled={!isAdmin} onChange={(e) => setPrices(prices.map((x, j) => (j === i ? e.target.value : x)))} />
              </td>
              <td className="num">{inToken(Number(p), 'SKR')}</td>
              <td className="num">{inToken(Number(p), 'ORE')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function GameSettingsCard({ cfg, wallet, isAdmin, run }: { cfg: Config; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const [form, setForm] = useState<Form>(() => toForm(cfg));
  const [prices, setPrices] = useState<string[]>(() => cfg.gearPricesUsd.map(String));
  const reset = () => {
    setForm(toForm(cfg));
    setPrices(cfg.gearPricesUsd.map(String));
  };

  // reset the form when the on-chain config changes
  const cfgKey = JSON.stringify(cfg, (_, v) => (v instanceof PublicKey ? v.toBase58() : v));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [cfgKey]);

  const { change, errors, dirty } = diffConfig(cfg, form, prices);
  const changed = Object.keys(change).length;

  return (
    <Card title="Game settings" hint="Only the fields you change are sent. The mints and the token prices are set elsewhere.">
      <div className="fields">
        {FIELDS.map((f) => (
          <label key={f.key} className={dirty(f.key) ? 'dirty' : ''}>
            <span>
              {f.label} <em>{f.unit}</em>
            </span>
            <input inputMode="decimal" value={form[f.key]} disabled={!isAdmin} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
            {f.hint ? <small>{f.hint}</small> : null}
          </label>
        ))}
      </div>
      <GearPrices cfg={cfg} prices={prices} setPrices={setPrices} isAdmin={isAdmin} />
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
        <button className="ghost" disabled={!changed} onClick={reset}>
          Reset
        </button>
      </div>
    </Card>
  );
}

function PauseCard({ cfg, wallet, isAdmin, run }: { cfg: Config; wallet?: AnchorWallet; isAdmin: boolean; run: Run }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Card
      title={cfg.paused ? 'Gali is paused' : 'Pause Gali'}
      hint="Pausing stops gear sales, round recording and jackpot claims. Staking and unstaking keep working, and players' ORE positions are never touched: those live in ORE's program."
    >
      {cfg.paused ? (
        <button disabled={!isAdmin} onClick={() => void run('Resume Gali', () => setPaused(wallet!, false))}>
          Resume Gali
        </button>
      ) : confirm ? (
        <div className="row">
          <button className="danger" disabled={!isAdmin} onClick={() => void run('Pause Gali', () => setPaused(wallet!, true)).then(() => setConfirm(false))}>
            Yes, pause now
          </button>
          <button className="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="danger" disabled={!isAdmin} onClick={() => setConfirm(true)}>
          Pause Gali…
        </button>
      )}
    </Card>
  );
}

function AdminCard({ cfg, wallet, isAdmin, isPending, run }: { cfg: Config; wallet?: AnchorWallet; isAdmin: boolean; isPending: boolean; run: Run }) {
  const [next, setNext] = useState('');
  const nextKey = parseKey(next);
  return (
    <Card title="Admin wallet" hint="Handing over is two steps: this wallet proposes, the new wallet accepts. All admin rights, including the treasuries, move with it. Use a multisig for launch.">
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
            <input value={next} disabled={!isAdmin} onChange={(e) => setNext(e.target.value)} placeholder="Wallet or multisig address" />
          </label>
          {next && !nextKey ? <p className="warn">That isn't a Solana address.</p> : null}
          <div className="row">
            <button disabled={!isAdmin || !nextKey} onClick={() => void run('Propose new admin', () => proposeAuthority(wallet!, nextKey!)).then((ok) => ok && setNext(''))}>
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
  );
}

export function SettingsTab({ d, wallet, isAdmin, isPending, run }: { d: Data; wallet?: AnchorWallet; isAdmin: boolean; isPending: boolean; run: Run }) {
  const { cfg } = d;
  return (
    <div className="two">
      <GameSettingsCard cfg={cfg} wallet={wallet} isAdmin={isAdmin} run={run} />
      <div className="stack">
        <PricesCard cfg={cfg} wallet={wallet} isAdmin={isAdmin} run={run} />
        <PauseCard cfg={cfg} wallet={wallet} isAdmin={isAdmin} run={run} />
        <AdminCard cfg={cfg} wallet={wallet} isAdmin={isAdmin} isPending={isPending} run={run} />
      </div>
    </div>
  );
}

/* ---------------- Players ---------------- */
type SortKey = 'points' | 'xp' | 'rounds' | 'wins' | 'solDeployed' | 'skrWon' | 'oreWon';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'points', label: 'Points' },
  { key: 'xp', label: 'XP' },
  { key: 'rounds', label: 'Rounds' },
  { key: 'wins', label: 'Wins' },
  { key: 'solDeployed', label: 'SOL deployed' },
  { key: 'skrWon', label: 'SKR won' },
  { key: 'oreWon', label: 'ORE won' },
];

export function PlayersTab({ d }: { d: Data }) {
  const [sort, setSort] = useState<SortKey>('points');
  const [q, setQ] = useState('');
  const rows = useMemo(
    () => d.players.filter((p) => !q || p.owner.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b[sort] - a[sort]),
    [d.players, sort, q],
  );
  return (
    <Card title={`Players (${d.players.length})`} hint="Rounds are counted when record_ore_round credits a finished ORE round. SKR and ORE won are jackpot payouts from Gali's pools.">
      <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search wallet" />
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Wallet</th>
            {SORTS.map((c) => (
              <th key={c.key}>
                <button className={`sort ${sort === c.key ? 'on' : ''}`} onClick={() => setSort(c.key)}>
                  {c.label}
                  {sort === c.key ? ' ↓' : ''}
                </button>
              </th>
            ))}
            <th>Staked SKR</th>
            <th>Staked ORE</th>
            <th>Gear</th>
            <th>Streak</th>
            <th>Last ORE round</th>
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
              <td className="num">{fmt(p.xp, 0)}</td>
              <td className="num">{fmt(p.rounds, 0)}</td>
              <td className="num">{fmt(p.wins, 0)}</td>
              <td className="num">{fmt(p.solDeployed, 3)}</td>
              <td className="num">{fmt(p.skrWon)}</td>
              <td className="num">{fmt(p.oreWon, 4)}</td>
              <td className="num">{fmt(p.stakedSkr, 0)}</td>
              <td className="num">{fmt(p.stakedOre, 4)}</td>
              <td className="num">{p.gearOwned}</td>
              <td className="num">{p.streak}</td>
              <td className="num">{p.lastOreRound || '-'}</td>
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
