/**
 * Step 1 of handing Gali's admin role to another wallet (e.g. your Phantom or a multisig).
 * Run by the current admin: `npx ts-node scripts/propose-admin.ts <new admin address>`.
 * Step 2: the new wallet opens the admin page and clicks "Accept admin role".
 */
import { PublicKey } from '@solana/web3.js';
import { pda, program } from './common';

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('usage: propose-admin.ts <new admin address>');
  const next = new PublicKey(arg);
  const { program: gali, wallet } = program();
  const cfg = await (gali.account as any).config.fetch(pda.config());
  if (cfg.authority.equals(next)) return console.log(`${next.toBase58()} is already the admin.`);
  if (cfg.pendingAuthority.equals(next)) return console.log(`${next.toBase58()} is already proposed. Accept it in the admin page.`);
  if (!cfg.authority.equals(wallet.publicKey)) {
    throw new Error(`Only the current admin (${cfg.authority.toBase58()}) can propose a new one; this wallet is ${wallet.publicKey.toBase58()}.`);
  }
  const sig = await gali.methods.proposeAuthority(next).accountsStrict({ authority: wallet.publicKey, config: pda.config() }).rpc();
  console.log(`Proposed ${next.toBase58()} as the new admin (${sig}).`);
  console.log('Next: open the admin page with that wallet, go to Settings, and click "Accept admin role".');
}
main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
