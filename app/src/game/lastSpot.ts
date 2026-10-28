/**
 * Web: after a page refresh your miner comes back where it was, on the same screen (lobby or ORE Island)
 * and on the same spot in the lobby. Saved in this browser only (localStorage), at most once a second.
 * The phone app keeps its own state while it runs, so it does not use this.
 */
const KEY = 'gali-last-spot';
/** a spot older than this is stale: start at the start again */
const KEEP_MS = 12 * 60 * 60_000;
const SAVE_MS = 1000;

export interface LastSpot {
  where: 'lobby' | 'island';
  x?: number;
  y?: number;
  at: number;
}

// a browser page (the phone app has no document); no react-native import, so the lobby tests can bundle this
const on = () => typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.addEventListener === 'function';

function read(): LastSpot | null {
  if (!on()) return null;
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (!v || (v.where !== 'lobby' && v.where !== 'island') || typeof v.at !== 'number' || Date.now() - v.at > KEEP_MS) return null;
    const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
    return { where: v.where, at: v.at, ...(ok(v.x) && ok(v.y) ? { x: v.x, y: v.y } : {}) };
  } catch {
    return null;
  }
}

/** read once when the page loads; later lobby visits use the normal door spawns */
const boot = read();
let spotUsed = false;

/** the screen to open on after a refresh */
export const bootWhere = (): 'lobby' | 'island' => boot?.where ?? 'lobby';

/** the lobby spot to start on after a refresh, once per page load */
export function takeBootSpot(): { x: number; y: number } | null {
  if (spotUsed || !boot || boot.where !== 'lobby' || boot.x === undefined || boot.y === undefined) return null;
  spotUsed = true;
  return { x: boot.x, y: boot.y };
}

let last: LastSpot = { where: boot?.where ?? 'lobby', x: boot?.x, y: boot?.y, at: 0 };
let lastWrite = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function write() {
  timer = null;
  lastWrite = Date.now();
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ ...last, at: lastWrite }));
  } catch {
    /* private window */
  }
}

function save(next: Partial<LastSpot>) {
  if (!on()) return;
  last = { ...last, ...next };
  if (timer) return;
  const wait = Math.max(0, SAVE_MS - (Date.now() - lastWrite));
  timer = setTimeout(write, wait);
}

/** the lobby calls this with my miner's position */
export const saveLobbySpot = (x: number, y: number) => save({ where: 'lobby', x: Math.round(x), y: Math.round(y) });
/** the app calls this when I change screens */
export const saveWhere = (where: 'lobby' | 'island') => save({ where });

// a refresh right after a move: write what we have before the page goes
if (on()) window.addEventListener('pagehide', () => {
  if (timer) {
    clearTimeout(timer);
    write();
  }
});
