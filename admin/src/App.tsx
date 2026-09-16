import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useCallback, useEffect, useState } from 'react';
import { CLUSTER, fetchBalances, fetchConfig, fetchPlayers, fetchPots, PROGRAM_ID, explorerAddr, short, type Balances, type Config, type PlayerRow, type PotRow } from './chain';
import { ChatTab, MoneyTab, OverviewTab, PlayersTab, RoundsTab, SettingsTab } from './sections';

export interface Data {
  cfg: Config;
  bal: Balances;
  pots: PotRow[];
  players: PlayerRow[];
  loadedAt: number;
}

export type Run = (label: string, fn: () => Promise<string | void>) => Promise<boolean>;
export interface Notice {
  tone: 'ok' | 'err' | 'busy';
  text: string;
  sig?: string;
}

const TABS = ['Overview', 'Money', 'Settings', 'Rounds', 'Players', 'Chat'] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const wallet = useAnchorWallet();
  const { publicKey } = useWallet();
  const [tab, setTab] = useState<Tab>(() => (TABS.find((t) => `#${t.toLowerCase()}` === location.hash) ?? 'Overview'));
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfg = await fetchConfig();
      if (!cfg) throw new Error('Gali is not set up on this cluster yet. Run npm run setup:devnet first.');
      const [bal, pots, players] = await Promise.all([fetchBalances(cfg.authority), fetchPots(cfg.decimals), fetchPlayers(cfg.decimals)]);
      setData({ cfg, bal, pots, players, loadedAt: Date.now() });
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    history.replaceState(null, '', `#${tab.toLowerCase()}`);
  }, [tab]);

  const me = publicKey?.toBase58() ?? null;
  const isAdmin = Boolean(data && me && me === data.cfg.authority);
  const isPending = Boolean(data && me && me === data.cfg.pendingAuthority);

  const run: Run = async (label, fn) => {
    setNotice({ tone: 'busy', text: `${label}… approve in your wallet` });
    try {
      const sig = await fn();
      setNotice({ tone: 'ok', text: `${label}: done`, sig: sig || undefined });
      await load();
      return true;
    } catch (e) {
      const m = String((e as Error).message ?? e);
      setNotice({ tone: 'err', text: `${label} failed: ${m.length > 180 ? `${m.slice(0, 180)}…` : m}` });
      return false;
    }
  };

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden>
            ⛏
          </span>
          <div>
            <h1>Gali Admin</h1>
            <a className="sub" href={explorerAddr(PROGRAM_ID.toBase58())} target="_blank" rel="noreferrer">
              {CLUSTER} · program {short(PROGRAM_ID.toBase58())}
            </a>
          </div>
        </div>
        <div className="top-right">
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <WalletMultiButton />
        </div>
      </header>

      {data ? (
        <div className={`role ${isAdmin ? 'admin' : isPending ? 'pending' : 'viewer'}`}>
          {isAdmin
            ? 'Connected as the admin wallet. Changes are live on-chain.'
            : isPending
              ? 'This wallet was proposed as the new admin. Accept it in Settings.'
              : me
                ? `View only. The admin wallet is ${short(data.cfg.authority)}.`
                : 'View only. Connect the admin wallet to make changes.'}
          {data.cfg.paused ? <strong className="paused-tag">PAUSED</strong> : null}
        </div>
      ) : null}

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>

      {notice ? (
        <div className={`notice ${notice.tone}`} role="status">
          <span>{notice.text}</span>
          {notice.sig ? (
            <a href={`https://explorer.solana.com/tx/${notice.sig}?cluster=${CLUSTER}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
          {notice.tone !== 'busy' ? (
            <button className="x" onClick={() => setNotice(null)} aria-label="Dismiss">
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      <main>
        {error ? <div className="card err">{error}</div> : null}
        {!data && !error ? <div className="card">Loading Gali from {CLUSTER}…</div> : null}
        {data ? (
          <>
            {tab === 'Overview' && <OverviewTab d={data} />}
            {tab === 'Money' && <MoneyTab d={data} wallet={wallet} isAdmin={isAdmin} run={run} />}
            {tab === 'Settings' && <SettingsTab d={data} wallet={wallet} isAdmin={isAdmin} isPending={isPending} run={run} />}
            {tab === 'Rounds' && <RoundsTab d={data} wallet={wallet} run={run} />}
            {tab === 'Players' && <PlayersTab d={data} />}
            {tab === 'Chat' && <ChatTab isAdmin={isAdmin} setNotice={setNotice} />}
          </>
        ) : null}
      </main>
      <footer>Updated {data ? new Date(data.loadedAt).toLocaleTimeString() : '…'} · refreshes every 30 s</footer>
    </div>
  );
}
