// The ORE board feed: the relay reads ORE's board and current round once every few seconds and pushes
// the raw accounts to every player who asked for them. Players stop polling the RPC themselves, so RPC
// use stays flat however many miners are online.
//
// Frame sent to clients: {"o":{"s":slot,"at":serverMs,"b":boardBase64,"r":roundBase64|null,"bt":blockTimeMs?}}
// The app decodes b and r with the same decoders it uses for its own reads (app/src/chain/ore).

import { BOARD_ADDRESS, roundAddress } from './solana.ts';

export type Rpc = (method: string, params: unknown[]) => Promise<unknown>;

export interface FeedFrame {
  s: number;
  at: number;
  b: string;
  r: string | null;
  bt?: number;
}

const BOARD_ROUND_ID_OFFSET = 8; // 8-byte discriminator, then round_id u64 LE
const NOT_STARTED = 0xffffffffffffffffn;
/** end_slot sits after round_id and start_slot */
const BOARD_END_SLOT_OFFSET = 24;

function u64At(b64: string, offset: number): bigint | null {
  const bin = atob(b64);
  if (bin.length < offset + 8) return null;
  let n = 0n;
  for (let i = 7; i >= 0; i--) n = (n << 8n) | BigInt(bin.charCodeAt(offset + i));
  return n;
}

interface AccountsResult {
  context: { slot: number };
  value: ({ data: [string, string] } | null)[];
}

export class OreFeed {
  last: FeedFrame | null = null;
  lastOkAt = 0;
  lastTryAt = 0;
  errors = 0;
  private busy = false;
  private roundId: bigint | null = null;
  private blockTimeAt = -Infinity;
  private blockTime: number | undefined;

  private rpc: Rpc;
  private now: () => number;

  constructor(rpc: Rpc, now: () => number = Date.now) {
    this.rpc = rpc;
    this.now = now;
  }

  /** How long to wait before the next read: quicker while a round is running. */
  interval(): number {
    if (this.errors > 0) return Math.min(30_000, 4000 * 2 ** Math.min(this.errors, 3));
    if (!this.last) return 4000;
    const end = u64At(this.last.b, BOARD_END_SLOT_OFFSET);
    if (end === NOT_STARTED) return 6000; // nobody has deployed yet; the clock has not started
    return 4000;
  }

  due() {
    return !this.busy && this.now() - this.lastTryAt >= this.interval();
  }

  /** Read the board and its round. Resolves to a frame, or null on failure (the old frame stays). */
  async poll(): Promise<FeedFrame | null> {
    if (this.busy) return null;
    this.busy = true;
    this.lastTryAt = this.now();
    try {
      const known = this.roundId;
      const keys = [BOARD_ADDRESS];
      if (known !== null) keys.push(await roundAddress(known));
      let res = (await this.rpc('getMultipleAccounts', [keys, { encoding: 'base64', commitment: 'confirmed' }])) as AccountsResult;
      const board = res?.value?.[0]?.data?.[0];
      if (!board) throw new Error('board missing');
      const id = u64At(board, BOARD_ROUND_ID_OFFSET);
      if (id === null) throw new Error('board too short');
      let round = known !== null && id === known ? (res.value[1]?.data?.[0] ?? null) : undefined;
      if (round === undefined) {
        // the round rolled over (or this is the first read): fetch the new round's account
        this.roundId = id;
        res = (await this.rpc('getMultipleAccounts', [[BOARD_ADDRESS, await roundAddress(id)], { encoding: 'base64', commitment: 'confirmed' }])) as AccountsResult;
        const b2 = res?.value?.[0]?.data?.[0];
        if (!b2) throw new Error('board missing');
        round = res.value[1]?.data?.[0] ?? null;
        if (u64At(b2, BOARD_ROUND_ID_OFFSET) !== id) this.roundId = null; // rolled again mid-read; settle next time
        return this.done(res.context.slot, b2, round);
      }
      return this.done(res.context.slot, board, round);
    } catch {
      this.errors++;
      return null;
    } finally {
      this.busy = false;
    }
  }

  private async done(slot: number, b: string, r: string | null): Promise<FeedFrame> {
    // the chain's wall clock, for the countdown's offset: refreshed every 60 s
    if (this.now() - this.blockTimeAt > 60_000) {
      this.blockTimeAt = this.now();
      try {
        const t = (await this.rpc('getBlockTime', [slot])) as number | null;
        if (typeof t === 'number') this.blockTime = t * 1000;
      } catch {
        // keep the previous one
      }
    }
    this.errors = 0;
    this.lastOkAt = this.now();
    this.last = { s: slot, at: this.now(), b, r, ...(this.blockTime !== undefined && this.now() - this.blockTimeAt < 1000 ? { bt: this.blockTime } : {}) };
    return this.last;
  }
}

/**
 * JSON-RPC over fetch. With two upstreams the calls take turns (halving each one's credit use), and a
 * failed call is retried on the other. Each attempt gets 6 s.
 */
export function makeRpc(urls: string[]): Rpc {
  let turn = 0;
  return async (method, params) => {
    let err: unknown = new Error('no RPC configured');
    const first = turn++ % Math.max(1, urls.length);
    for (let k = 0; k < urls.length; k++) {
      const i = (first + k) % urls.length;
      try {
        const res = await fetch(urls[i], {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const j = (await res.json()) as { result?: unknown; error?: { message: string } };
        if (j.error) throw new Error(j.error.message);
        return j.result;
      } catch (e) {
        err = e;
      }
    }
    throw err;
  };
}
