/** Optional: reveal each round as soon as it ends so players see results instantly. */
import { SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { pda, program } from './common';

async function main() {
  const { program: gali, wallet } = program();
  const cfg = await (gali.account as any).config.fetch(pda.config());
  const secs: number = cfg.roundSecs;
  let last = -1;
  for (;;) {
    const prev = Math.floor(Date.now() / 1000 / secs) - 1;
    if (prev !== last) {
      try {
        await gali.methods
          .revealRound(new (require('@coral-xyz/anchor').BN)(prev))
          .accountsStrict({
            payer: wallet.publicKey,
            config: pda.config(),
            round: pda.round(prev),
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log('revealed', prev);
      } catch (e) {
        console.log('skip', prev, (e as Error).message.slice(0, 80));
      }
      last = prev;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
main();
