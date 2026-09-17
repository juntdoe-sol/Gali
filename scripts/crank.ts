/**
 * Keeps rounds moving: once a round ends it locks and reveals it, settles its SOL pot, and pays out
 * every stake (winners get SOL + SKR even if their app is closed). All three steps are
 * permissionless; settle_pot still sends the SOL fee to the config authority.
 * Run with any funded wallet: `npm run crank` (RPC_URL and ANCHOR_WALLET are honoured).
 */
import { BN, utils } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { lockAndReveal, pda, program, u64le } from './common';

const LOOKBACK = Number(process.env.CRANK_LOOKBACK ?? 5); // also retry this many older rounds
const STAKE_ROUND_OFFSET = 8 + 32 + 32; // Stake: disc | owner | payer | round_id

async function main() {
  const { program: gali, wallet } = program();
  const conn = gali.provider.connection;
  const acc = gali.account as any;
  const cfg = await acc.config.fetch(pda.config());
  const secs: number = cfg.roundSecs;
  const short = (e: unknown) => String((e as Error).message ?? e).slice(0, 90);

  async function handle(r: number) {
    const pot = await acc.pot.fetchNullable(pda.pot(r));
    if (!pot) return; // nobody deployed
    if (!(await conn.getAccountInfo(pda.round(r)))) {
      await lockAndReveal(gali, wallet.publicKey, r);
      console.log('revealed', r);
    }
    if (!(await acc.pot.fetch(pda.pot(r))).settled) {
      const { authority } = await acc.config.fetch(pda.config()); // may have been handed over
      await gali.methods
        .settlePot(new BN(r))
        .accountsStrict({
          config: pda.config(),
          round: pda.round(r),
          pot: pda.pot(r),
          feeTo: authority,
          skrMint: cfg.skrMint,
          rewards: pda.rewards(),
          motherlode: pda.motherlode(),
          potVault: pda.potVault(),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc()
        .then(() => console.log('settled', r, `${Number(pot.total) / 1e9} SOL`))
        .catch((e: unknown) => console.log('settle skip', r, short(e))); // a player's app may have settled first
    }
    const stakes = await acc.stake.all([{ memcmp: { offset: STAKE_ROUND_OFFSET, bytes: utils.bytes.bs58.encode(u64le(r)) } }]);
    for (const { publicKey, account: s } of stakes) {
      const owner: PublicKey = s.owner;
      try {
        await gali.methods
          .claimPot(new BN(r))
          .accountsStrict({
            cranker: wallet.publicKey,
            owner,
            payer: s.payer,
            config: pda.config(),
            player: pda.player(owner),
            round: pda.round(r),
            pot: pda.pot(r),
            stake: publicKey,
            unclaimed: pda.unclaimed(owner),
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log('  credited', owner.toBase58().slice(0, 8), 'round', r); // lands in their Unclaimed balance
      } catch (e) {
        console.log('  claim skip', owner.toBase58().slice(0, 8), short(e)); // the player's app may have claimed first
      }
    }
  }

  for (;;) {
    const current = Math.floor(Date.now() / 1000 / secs);
    for (let r = current - LOOKBACK; r < current; r++) {
      try {
        await handle(r);
      } catch (e) {
        console.log('round', r, 'skip:', short(e));
      }
    }
    await new Promise((res) => setTimeout(res, Math.max(3000, ((current + 1) * secs - Date.now() / 1000) * 1000 + 2000)));
  }
}
main();
