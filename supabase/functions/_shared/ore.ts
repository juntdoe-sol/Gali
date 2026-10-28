// Reads ORE's mainnet accounts for the edge functions (no web3.js, to keep cold starts fast).
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import bs58 from 'npm:bs58@6';
import { boardRoundId, minerFields, roundFields } from './score.ts';

export const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
export const ORE_BOARD = 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi';

function rpcUrl() {
  const url = Deno.env.get('SOLANA_RPC');
  if (!url) throw new Error('SOLANA_RPC is not set');
  return url;
}
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const enc = new TextEncoder();
async function pda(seeds: Uint8Array[], programId: string) {
  const pid = bs58.decode(programId);
  const tail = enc.encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const parts = new Uint8Array([...seeds.flatMap((s) => [...s]), bump, ...pid, ...tail]);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', parts));
    try {
      ed25519.Point.fromBytes(h);
    } catch {
      return bs58.encode(h);
    }
  }
  throw new Error('no PDA');
}
const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};
export const minerAddress = (wallet: string) => pda([enc.encode('miner'), bs58.decode(wallet)], ORE_PROGRAM);
export const roundAddress = (id: bigint) => pda([enc.encode('round'), u64le(id)], ORE_PROGRAM);

/** Several accounts at once, as bytes; null for a missing account or one ORE does not own. */
export async function oreAccounts(addresses: string[]): Promise<(Uint8Array | null)[]> {
  const res = await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }]);
  return (res?.value ?? []).map((a: { owner: string; data: [string, string] } | null) =>
    a && a.owner === ORE_PROGRAM ? Uint8Array.from(atob(a.data[0]), (c) => c.charCodeAt(0)) : null,
  );
}

/** The wallet's ORE miner, the round it holds and the board's current round, read in one call. */
export async function readMinerRound(wallet: string) {
  const minerAddr = await minerAddress(wallet);
  const [board, minerData] = await oreAccounts([ORE_BOARD, minerAddr]);
  if (!board) throw new Error('ORE board not found');
  const current = boardRoundId(board);
  if (!minerData) return { current, miner: null, round: null };
  const miner = minerFields(minerData);
  if (bs58.encode(miner.authority) !== wallet) return { current, miner: null, round: null };
  const [roundData] = await oreAccounts([await roundAddress(miner.roundId)]);
  return { current, miner, round: roundData ? roundFields(roundData) : null };
}
