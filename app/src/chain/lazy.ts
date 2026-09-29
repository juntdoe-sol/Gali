/**
 * Loaders for the heavy chain code. On web, `import('./heavy')` becomes its own chunk,
 * fetched the first time something needs it. Nothing in the startup bundle may import
 * ./client, ./board, ./ore/* or ./heavy statically (types via `import type` are fine).
 *
 * Keep this the only `import()` of chain code: see heavy.ts for why a second one
 * would pull web3.js back into the first load.
 *
 * Memoized: the first call starts the fetch and later calls share it. A failed
 * fetch (offline) is forgotten so the next call tries again.
 */
type HeavyMod = typeof import('./heavy');
type ChainMod = HeavyMod['client'];
type BoardMod = HeavyMod['board'];
type OreTxMod = HeavyMod['oreTx'];

let chainMod: ChainMod | null = null;
let heavyP: Promise<HeavyMod> | null = null;

const loadHeavy = (): Promise<HeavyMod> =>
  (heavyP ??= import('./heavy').then(
    (m) => {
      chainMod = m.client;
      return m;
    },
    (e) => {
      heavyP = null;
      throw e;
    },
  ));

export const loadChain = (): Promise<ChainMod> => loadHeavy().then((m) => m.client);
export const loadBoard = (): Promise<BoardMod> => loadHeavy().then((m) => m.board);
export const loadOreTx = (): Promise<OreTxMod> => loadHeavy().then((m) => m.oreTx);

/** The chain module if it has already loaded, else null (for code that can't wait a frame). */
export const loadedChain = (): ChainMod | null => chainMod;
