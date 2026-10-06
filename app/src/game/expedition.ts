// Pure, nonfinancial expedition rules. No wallet, token or wagering state.
export type Mine = 'crystal' | 'tunnel' | 'seam';
export type Challenge = 'standard' | 'careful' | 'rush';
export type Tool = 'pickaxe' | 'drill' | 'shovel';
export type Rock = 'clay' | 'rubble' | 'basalt' | 'crystal' | 'relic';
export type Cell = { rock: Rock; hp: number; broken: boolean };
export type Expedition = {
  day: string; mine: Mine; challenge: Challenge; cells: Cell[]; position: number;
  stamina: number; deadline: number; materials: number; relics: number; damaged: number;
  score: number; status: 'active' | 'extracted' | 'timeout'; message: string;
};
export const MINES: Record<Mine, string> = { crystal: 'Crystal cavern', tunnel: 'Collapsed tunnel', seam: 'Deep seam' };
export const CHALLENGES: Record<Challenge, { name: string; xp: number; seconds: number; stamina: number }> = {
  standard: { name: 'Survey', xp: 0, seconds: 90, stamina: 28 },
  careful: { name: 'Fragile survey', xp: 30, seconds: 90, stamina: 22 },
  rush: { name: 'Short shift', xp: 80, seconds: 45, stamina: 28 },
};
export const adjacent = (a: number, b: number) => Number.isInteger(b) && b >= 0 && b < 25 && Math.abs(a % 5 - b % 5) + Math.abs(Math.floor(a / 5) - Math.floor(b / 5)) === 1;
export type Action = 'extract' | 'tick' | { tile: number; tool: Tool };
export function act(run: Expedition, action: Action, now: number): Expedition {
  if (run.status !== 'active') return run;
  if (now >= run.deadline) return { ...run, status: 'timeout', score: 0, message: 'Shift ended. Unextracted game materials lost. No wallet assets affected.' };
  if (action === 'tick') return run;
  if (action === 'extract') return { ...run, status: 'extracted', score: run.materials * 2 + run.relics * 10, message: 'Extracted safely. Game score only; no tokens or prizes.' };
  if (!adjacent(run.position, action.tile)) return { ...run, message: 'Choose an adjacent tile, not a diagonal.' };
  const cell = run.cells[action.tile];
  if (!cell.hp) return { ...run, position: action.tile, message: 'Moved through the cleared route.' };
  const cost = action.tool === 'drill' ? 3 : action.tool === 'pickaxe' ? 2 : 1;
  if (run.stamina < cost) return { ...run, message: 'Not enough stamina. Switch tools or extract now.' };
  const soft = cell.rock === 'clay' || cell.rock === 'rubble' || cell.rock === 'relic';
  const power = action.tool === 'drill' ? 6 : action.tool === 'pickaxe' ? 3 : soft ? 3 : 1;
  const fragile = cell.rock === 'crystal' || cell.rock === 'relic';
  const broken = cell.broken || (action.tool === 'drill' && fragile);
  const hp = Math.max(0, cell.hp - power);
  const cells = run.cells.map((c, i) => i === action.tile ? { ...c, hp, broken } : c);
  return { ...run, cells, stamina: run.stamina - cost, position: hp ? run.position : action.tile,
    materials: run.materials + (!hp ? cell.rock === 'crystal' && !broken ? 3 : 1 : 0),
    relics: run.relics + (!hp && cell.rock === 'relic' && !broken ? 1 : 0),
    damaged: run.damaged + (!cell.broken && broken ? 1 : 0),
    message: broken && !cell.broken ? 'Drill shattered a fragile collectible.' : hp ? `${cell.rock}: ${hp} strength left.` : `Cleared ${cell.rock}. Choose the next step or extract.` };
}
export type Progress = { v: 1; best: Record<string, number> };
export const bestKey = (r: Pick<Expedition, 'day' | 'mine' | 'challenge'>) => `${r.day}:${r.mine}:${r.challenge}`;
export function recordBest(p: Progress, run: Expedition): Progress {
  const key = bestKey(run);
  if (run.status !== 'extracted' || run.score <= (p.best[key] ?? 0)) return p;
  return { v: 1, best: { ...p.best, [key]: run.score } };
}
export function mastery(p: Progress) {
  const xp = Object.values(p.best).reduce((a, b) => a + b, 0);
  return { xp, title: xp >= 80 ? 'Deep explorer' : xp >= 30 ? 'Careful excavator' : 'New surveyor' };
}
export function parseProgress(raw: string | null): Progress {
  if (raw === null) return { v: 1, best: {} };
  if (raw.length > 1_000_000) throw new Error('Expedition save too large');
  const p = JSON.parse(raw);
  if (!p || p.v !== 1 || !p.best || typeof p.best !== 'object' || Array.isArray(p.best) ||
    Object.entries(p.best).some(([k, v]) => !/^\d{4}-\d{2}-\d{2}:(crystal|tunnel|seam):(standard|careful|rush)$/.test(k) || !Number.isInteger(v) || Number(v) < 0 || Number(v) > 288)) throw new Error('Invalid expedition save');
  return { v: 1, best: { ...p.best } };
}
export type SharedScore = { v: 1; day: string; id: string; mine: Mine; challenge: Challenge; score: number };
export function acceptScore(scores: SharedScore[], input: unknown, day: string, ownId?: string): SharedScore[] {
  const today = scores.filter((s) => s.day === day);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return today;
  const p = input as SharedScore;
  if (Object.keys(p).sort().join(',') !== 'challenge,day,id,mine,score,v' || p.v !== 1 || p.day !== day ||
    typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{4,16}$/.test(p.id) ||
    !['crystal', 'tunnel', 'seam'].includes(p.mine) || !['standard', 'careful', 'rush'].includes(p.challenge) ||
    !Number.isInteger(p.score) || p.score < 0 || p.score > 288) return today;
  const index = today.findIndex((s) => s.id === p.id && s.mine === p.mine && s.challenge === p.challenge);
  if (index >= 0 && today[index].score >= p.score) return today;
  // Own nine mine/challenge slots never compete with the bounded remote pool.
  if (index < 0 && p.id !== ownId && today.filter((s) => s.id !== ownId).length >= 180) return today;
  const clean: SharedScore = { v: 1, day, id: p.id, mine: p.mine, challenge: p.challenge, score: p.score };
  if (index < 0) return [...today, clean];
  return today.map((s, i) => i === index ? clean : s);
}
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export function startExpedition(day: string, mine: Mine, challenge: Challenge, now: number): Expedition {
  let seed = 2166136261;
  for (const c of `${day}:${mine}:${challenge}:v1`) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619) >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const rocks: Rock[] = mine === 'crystal' ? ['clay', 'crystal', 'crystal', 'basalt', 'relic']
    : mine === 'tunnel' ? ['rubble', 'rubble', 'clay', 'relic', 'crystal'] : ['basalt', 'basalt', 'crystal', 'rubble', 'relic'];
  const cells = Array.from({ length: 25 }, (_, i): Cell => {
    const rock = rocks[Math.floor(random() * rocks.length)];
    return { rock, hp: i === 22 ? 0 : rock === 'basalt' ? 6 : rock === 'rubble' ? 3 : 2, broken: false };
  });
  return { day, mine, challenge, cells, position: 22, stamina: CHALLENGES[challenge].stamina,
    deadline: now + CHALLENGES[challenge].seconds * 1000, materials: 0, relics: 0, damaged: 0,
    score: 0, status: 'active', message: 'Choose an adjacent tile. Extract before the shift ends.' };
}
