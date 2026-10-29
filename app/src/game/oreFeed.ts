// Where the live board comes from when the relay is up: one read by the relay for everyone, pushed
// every few seconds (relay/src/ore.ts). world.ts plugs the relay in; store.ts reads from here and only
// polls the RPC itself when the feed is missing or stale. Kept free of imports so store.ts can use it
// without pulling in the realtime code.

import type { OreFeedFrame } from './relay';

interface Source {
  followOre(cb: (f: OreFeedFrame) => void): () => void;
}

/** A frame older than this is ignored and the app reads the chain itself, as before the relay. */
export const FEED_STALE_MS = 9000;

let source: Source | null = null;
let stop: (() => void) | null = null;
let listener: ((f: OreFeedFrame) => void) | null = null;
let last: { f: OreFeedFrame; at: number } | null = null;

export function setOreSource(s: Source | null) {
  stop?.();
  stop = null;
  source = s;
  last = null;
  if (s && listener) stop = s.followOre(onFrame);
}

function onFrame(f: OreFeedFrame) {
  last = { f, at: Date.now() };
  listener?.(f);
}

/** Start (or keep) following the feed. One listener: the live store. */
export function followOreFeed(cb: (f: OreFeedFrame) => void) {
  listener = cb;
  if (source && !stop) stop = source.followOre(onFrame);
}

export function unfollowOreFeed() {
  listener = null;
  stop?.();
  stop = null;
}

/** The newest frame, if it arrived recently enough to trust. */
export function freshOre(maxAgeMs = FEED_STALE_MS): { f: OreFeedFrame; at: number } | null {
  return last && Date.now() - last.at < maxAgeMs ? last : null;
}
