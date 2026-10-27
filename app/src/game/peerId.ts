/**
 * Player ids that carry the wallet. Realtime broadcasts are not authenticated, so anyone can send a packet with
 * any id. A player with a wallet uses an id that starts with the first 8 characters of that wallet, and a packet's
 * wallet is only believed when the id it came with starts with that wallet's first 8 characters. Someone can still
 * copy another player's id, but then the only wallet they can show with it is that player's own, so a tip or a DM
 * can never be steered to the copier.
 */
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BIND = 8;
const tail = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

/** The id to use with this wallet: the current one when it already fits, else a fresh wallet-bound id. */
export function idFor(wallet: string | null | undefined, current: string): string {
  if (!wallet || !B58.test(wallet)) return current;
  const head = wallet.slice(0, BIND);
  return current.startsWith(head) && current.length === BIND + 4 ? current : head + tail();
}

/** The wallet a packet may claim for this id, or null. */
export function boundWallet(id: string, w: unknown): string | null {
  return typeof w === 'string' && B58.test(w) && id.startsWith(w.slice(0, BIND)) ? w : null;
}
