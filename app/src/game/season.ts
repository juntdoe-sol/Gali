/**
 * Seasons: a limited-time look for the whole game, switched on by the calendar.
 *
 * A season changes only how things look and read: colours, decorations, a banner. It never touches
 * numbers, odds, fees, rewards or what a money button does.
 *
 * Pure (no React Native), so the canvas engines read the same answer as the app.
 * On the web, `?season=hollow` or `?season=off` forces a season for testing.
 */

export type SeasonId = 'hollow';

export interface Season {
  id: SeasonId;
  name: string;
  tag: string;
  /** wall-clock ms, start inclusive, end exclusive */
  start: number;
  end: number;
}

/** Hollow Night: 24 Oct to 5 Nov 2026, Malaysia time (UTC+8), last day included. */
export const HOLLOW: Season = {
  id: 'hollow',
  name: 'HOLLOW NIGHT',
  tag: 'The island never sees the sun',
  start: Date.parse('2026-10-24T00:00:00+08:00'),
  end: Date.parse('2026-11-06T00:00:00+08:00'),
};

export const SEASONS: Season[] = [HOLLOW];

function forced(): SeasonId | 'off' | null {
  try {
    const q = (globalThis as { location?: { search?: string } }).location?.search ?? '';
    const m = /[?&]season=([a-z]+)/.exec(q);
    if (!m) return null;
    if (m[1] === 'off' || m[1] === 'none') return 'off';
    return SEASONS.some((s) => s.id === m[1]) ? (m[1] as SeasonId) : null;
  } catch {
    return null;
  }
}

/** The season running at `now`, or null. */
export function seasonAt(now: number): Season | null {
  const f = forced();
  if (f === 'off') return null;
  if (f) return SEASONS.find((s) => s.id === f) ?? null;
  return SEASONS.find((s) => now >= s.start && now < s.end) ?? null;
}

/** The season at app start. Colours are picked once at load, so a season that starts or ends mid-session shows on the next launch. */
export const SEASON: Season | null = seasonAt(Date.now());
export const IS_HOLLOW = SEASON?.id === 'hollow';

/** "8d 14h", "5h 12m", "12m": time left in the running season, or '' when none is running. */
export function seasonLeft(now = Date.now()): string {
  if (!SEASON) return '';
  const ms = Math.max(0, SEASON.end - now);
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}
