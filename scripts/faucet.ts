/** Send mock SKR to a tester: npx ts-node scripts/faucet.ts <wallet> [amount] */
import { getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import dep from '../app/src/chain/deployment.json';
import { program } from './common';

async function main() {
  const [to, amount = '5000'] = process.argv.slice(2);
  const { provider, wallet } = program();
  const mint = new PublicKey(dep.skrMint);
  const ata = await getOrCreateAssociatedTokenAccount(provider.connection, wallet.payer, mint, new PublicKey(to));
  await mintTo(provider.connection, wallet.payer, mint, ata.address, wallet.payer, BigInt(amount) * 10n ** BigInt(dep.skrDecimals));
  console.log(`sent ${amount} test SKR to ${to}`);
}
main();
