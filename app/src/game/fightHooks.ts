/**
 * Where Brawl's moments go: your fight record (game/fightGear.ts) and the ranks (game/ranks.ts).
 * A KO counts for the ranks when the miner who went down reports it; a win when the arena host does.
 */
import { hostResultListeners, resultListeners, useArena } from './arena';
import { brawlHooks } from './brawl';
import { useFightStats } from './fightGear';
import { reportKo, reportWin } from './ranks';
import { useGame } from './store';

let done = false;
export function initFightHooks(myName: () => string) {
  if (done) return;
  done = true;
  const koed = brawlHooks.koed;
  brawlHooks.koed = (scope, foe, name, xp) => {
    koed?.(scope, foe, name, xp);
    useFightStats.getState().add('kos');
    useGame.getState().track('ko');
  };
  const kod = brawlHooks.kodBy;
  brawlHooks.kodBy = (scope, by, byName) => {
    kod?.(scope, by, byName);
    useFightStats.getState().add('downs');
    if (by !== 'boss' && byName) reportKo({ killer: byName, victim: myName(), scope });
  };
  resultListeners.add((m) => {
    const me = useArena.getState().me;
    useGame.getState().track('arena');
    if (m.winner === me && m.fighters.length >= 2) useGame.getState().track('win');
    if (m.mode === 'boss' && m.winner === 'boss-down') {
      useFightStats.getState().add('bossWins');
      // every miner who fought the boss reports their own win, so a solo boss fight counts on the ranks
      reportWin({ winner: myName(), host: myName(), mode: 'boss', players: m.fighters.length });
    }
    else if (m.winner === me && m.fighters.length >= 2) useFightStats.getState().add('wins');
  });
  hostResultListeners.add((m) => {
    if (m.mode !== 'boss' && m.winner && m.winnerName && m.fighters.length >= 2) reportWin({ winner: m.winnerName, host: myName(), mode: m.mode, players: m.fighters.length });
  });
}
