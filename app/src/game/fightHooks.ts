/**
 * Where Brawl's moments go: your fight record (game/fightGear.ts) and the ranks (game/ranks.ts).
 * A KO counts for the ranks when the miner who went down reports it, naming the wallet of the miner who did it
 * (only a wallet bound to that player's id, see game/peerId.ts). A win counts when the winner reports it.
 */
import { resultListeners, useArena } from './arena';
import { brawlHooks } from './brawl';
import { useFightStats } from './fightGear';
import { reportKo, reportWin } from './ranks';
import { useGame } from './store';
import { useLobby } from './lobby';
import { useWorld } from './world';

/** The wallet bound to a player id in the room the fight happened in, or null. */
function walletOf(scope: string, id: string): string | null {
  if (scope === 'arena') return useArena.getState().peers[id]?.wallet ?? null;
  if (scope === 'lobby') return useLobby.getState().peers[id]?.wallet ?? null;
  return useWorld.getState().peers?.[id]?.wallet ?? null;
}

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
    if (by !== 'boss' && byName) reportKo({ killer: walletOf(scope, by), scope });
  };
  resultListeners.add((m) => {
    const me = useArena.getState().me;
    useGame.getState().track('arena');
    if (m.winner === me && m.fighters.length >= 2) useGame.getState().track('win');
    if (m.mode === 'boss' && m.winner === 'boss-down') {
      useFightStats.getState().add('bossWins');
      // every miner who fought the boss reports their own win, so a solo boss fight counts on the ranks
      reportWin({ mode: 'boss', players: m.fighters.length });
    } else if (m.mode === 'waves' && m.winner === 'waves-won' && m.fighters.includes(me)) {
      // the squad held the hall: each of the three reports their own win (the match's winner is "THE MINERS")
      reportWin({ mode: 'waves', players: m.fighters.length });
    }
    else if (m.winner === me && m.fighters.length >= 2) {
      useFightStats.getState().add('wins');
      reportWin({ mode: m.mode, players: m.fighters.length });
    }
  });
}
