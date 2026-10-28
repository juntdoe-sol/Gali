/**
 * Hand Gali's config authority and upgrade authority to a Squads v4 multisig vault.
 *
 * Run AFTER the program is deployed and init_config has run (init_config needs the upgrade authority's
 * signature, so the upgrade authority moves last). Run it with the current admin wallet, which should also be
 * one of the multisig's members:
 *
 *   RPC_URL=<mainnet RPC> ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/multisig-handover.ts <multisig address>
 *
 * What it does:
 *   1. Proposes the multisig's vault (index 0) as the new config authority (propose_authority).
 *   2. Creates a Squads vault transaction and proposal that calls accept_authority from the vault. The members
 *      approve and execute it in the Squads app (app.squads.so); once it runs, only the multisig can change
 *      prices, pause, or move the admin role again.
 *   3. Prints the one command that moves the program's upgrade authority to the same vault.
 * Safe to run again: it skips whatever is already done.
 */
import * as multisig from '@sqds/multisig';
import { PublicKey, TransactionMessage } from '@solana/web3.js';
import { pda, program, PROGRAM_ID } from './common';

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('usage: multisig-handover.ts <squads multisig address>');
  const multisigPda = new PublicKey(arg);
  const { program: gali, wallet, provider } = program();
  const connection = provider.connection;
  const [vault] = multisig.getVaultPda({ multisigPda, index: 0 });
  const ms = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  console.log(`Multisig ${multisigPda.toBase58()}: ${ms.members.length} members, ${ms.threshold} must approve. Vault: ${vault.toBase58()}`);
  if (ms.threshold < 2) console.log('Warning: a threshold of 1 is a single key with extra steps. Use 2 of 3 or more.');

  const cfg = await (gali.account as any).config.fetchNullable(pda.config());
  if (!cfg) throw new Error('The Gali config does not exist yet. Run init_config first, then this script.');

  // 1. propose the vault
  if (cfg.authority.equals(vault)) {
    console.log('1. Config authority: already the vault.');
  } else {
    if (!cfg.pendingAuthority.equals(vault)) {
      if (!cfg.authority.equals(wallet.publicKey)) throw new Error(`Only the current admin (${cfg.authority.toBase58()}) can propose the vault; this wallet is ${wallet.publicKey.toBase58()}.`);
      const sig = await gali.methods.proposeAuthority(vault).accountsStrict({ authority: wallet.publicKey, config: pda.config() }).rpc();
      console.log(`1. Proposed the vault as config authority (${sig}).`);
    } else {
      console.log('1. The vault is already proposed.');
    }

    // 2. the vault accepts, through a Squads proposal
    const member = ms.members.some((m) => m.key.equals(wallet.publicKey));
    const accept = await gali.methods.acceptAuthority().accountsStrict({ newAuthority: vault, config: pda.config() }).instruction();
    if (!member) {
      console.log('2. This wallet is not a member, so it cannot create the Squads proposal. In the Squads app, create a');
      console.log(`   transaction from the vault that calls accept_authority on program ${PROGRAM_ID.toBase58()} with accounts:`);
      console.log(`   new_authority = ${vault.toBase58()} (signer), config = ${pda.config().toBase58()} (writable), data = ${Buffer.from(accept.data).toString('hex')}`);
    } else {
      const index = BigInt(ms.transactionIndex.toString()) + 1n;
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const transactionMessage = new TransactionMessage({ payerKey: vault, recentBlockhash: blockhash, instructions: [accept] });
      const s1 = await multisig.rpc.vaultTransactionCreate({ connection, feePayer: wallet.payer, multisigPda, transactionIndex: index, creator: wallet.publicKey, vaultIndex: 0, ephemeralSigners: 0, transactionMessage, memo: 'Gali: vault accepts the config authority' });
      await connection.confirmTransaction(s1, 'confirmed');
      const s2 = await multisig.rpc.proposalCreate({ connection, feePayer: wallet.payer, multisigPda, transactionIndex: index, creator: wallet.payer });
      await connection.confirmTransaction(s2, 'confirmed');
      console.log(`2. Squads proposal #${index} created. Members approve and execute it in the Squads app.`);
    }
  }

  // 3. the upgrade authority
  const programInfo = await connection.getAccountInfo(PROGRAM_ID);
  if (!programInfo) throw new Error('Program not found on this network.');
  const programData = new PublicKey(programInfo.data.subarray(4, 36));
  const pd = await connection.getAccountInfo(programData);
  const current = pd && pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null;
  if (current && current.equals(vault)) {
    console.log('3. Upgrade authority: already the vault.');
  } else {
    console.log(`3. Upgrade authority is ${current ? current.toBase58() : 'none (immutable)'}. Once proposal #2 has executed, run with that key:`);
    console.log(`   solana program set-upgrade-authority ${PROGRAM_ID.toBase58()} --new-upgrade-authority ${vault.toBase58()} --skip-new-upgrade-authority-signer-check -u <rpc> -k <upgrade authority keypair>`);
    console.log('   Future upgrades then go through Squads (Developers > Programs in the Squads app).');
  }
}
main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
