/**
 * Optional helper: reveals each round as soon as it ends and settles its SOL pot,
 * so players see results instantly. Run with the config authority wallet
 * (settle_pot sends the SOL fee to the authority, but anyone may sign it).
 */
import { BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { pda, program } from './common';

async function main() {
  const { program: gali, wallet } = program();
  const acc = gali.account as any;
  const cfg = await acc.config.fetch(pda.config());
  const secs: number = cfg.roundSecs;
  let last = -1;
  for (;;) {
    const prev = Math.floor(Date.now() / 1000 / secs) - 1;
    if (prev !== last) {
      try {
        await gali.methods
          .revealRound(new BN(prev))
          .accountsStrict({ payer: wallet.publicKey, config: pda.config(), round: pda.round(prev), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
          .rpc();
        console.log('revealed', prev);
      } catch (e) {
        console.log('reveal skip', prev, (e as Error).message.slice(0, 80));
      }
      try {
        const pot = await acc.pot.fetchNullable(pda.pot(prev));
        if (pot && !pot.settled) {
          await gali.methods
            .settlePot(new BN(prev))
            .accountsStrict({
              config: pda.config(),
              round: pda.round(prev),
              pot: pda.pot(prev),
              feeTo: cfg.authority,
              skrMint: cfg.skrMint,
              rewards: pda.rewards(),
              motherlode: pda.motherlode(),
              potVault: pda.potVault(),
              tokenProgram: TOKEN_PROGRAM_ID,
            })
            .rpc();
          console.log('settled pot', prev, pot.total.toString());
        }
      } catch (e) {
        console.log('settle skip', prev, (e as Error).message.slice(0, 80));
      }
      last = prev;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
main();
