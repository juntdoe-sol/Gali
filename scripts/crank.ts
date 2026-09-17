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
    const info = await conn.getAccountInfo(pda.pot(r));
    if (!info) return; // nobody deployed
    if (info.data.length < acc.pot.size) {
      // a round from before the payout upgrade: this program version can't settle or claim it
      console.log('round', r, 'skip: old-format pot (finish it with the pre-upgrade crank)');
      return;
    }
    const pot = gali.coder.accounts.decode('pot', info.data);
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
            refinery: pda.refinery(),
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log('  credited', owner.toBase58().slice(0, 8), 'round', r); // lands in their Unclaimed balance
      } catch (e) {
        console.log('  claim skip', owner.toBase58().slice(0, 8), short(e)); // the player's app may have claimed first
      }
    }
  }

  // a day after a round, give the pot and round rent back to whoever paid it (once every stake is claimed)
  let lastSweep = 0;
  async function sweep() {
    if (Date.now() - lastSweep < 10 * 60_000) return;
    lastSweep = Date.now();
    const pots: { account: any }[] = await acc.pot.all([{ dataSize: acc.pot.size }]);
    const cutoff = Math.floor(Date.now() / 1000) - 86_400;
    for (const { account: p } of pots) {
      const r = Number(p.roundId);
      if (!p.settled || p.claimed < p.miners || (r + 1) * secs > cutoff) continue;
      const info = await conn.getAccountInfo(pda.round(r));
      if (!info) continue;
      let round: any;
      try {
        round = gali.coder.accounts.decode('round', info.data);
      } catch {
        continue; // a round from before rent tracking
      }
      await gali.methods
        .closeRound(new BN(r))
        .accountsStrict({ config: pda.config(), pot: pda.pot(r), round: pda.round(r), potRentPayer: p.rentPayer, roundRentPayer: round.rentPayer })
        .rpc()
        .then(() => console.log('closed', r, '(rent refunded)'))
        .catch((e: unknown) => console.log('close skip', r, short(e)));
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
    await sweep().catch((e) => console.log('sweep skip', short(e)));
    await new Promise((res) => setTimeout(res, Math.max(3000, ((current + 1) * secs - Date.now() / 1000) * 1000 + 2000)));
  }
}
main();
