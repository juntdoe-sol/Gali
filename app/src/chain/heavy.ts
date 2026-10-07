/**
 * The one lazily loaded entry for all the heavy chain code (web3.js, Anchor, spl-token,
 * Mobile Wallet Adapter). Only ./lazy imports this, and only with `import()`.
 *
 * Why one entry: Expo's web serializer moves every module shared by two async chunks
 * into a `__common` chunk that index.html loads at startup. Separate `import()`s of
 * client, board and ore/tx all share web3.js, so they would drag it back into the
 * first load. Behind this single barrel they become one chunk fetched on demand.
 */
import './polyfill-web';
import * as client from './client';
import * as board from './board';
import * as oreTx from './ore/tx';
import * as arcade from './arcade';

export { arcade, board, client, oreTx };
