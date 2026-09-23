/**
 * Reads the real ORE and SKR mints on mainnet and prints everything the Gali
 * program needs to know before it can hold or move them:
 *
 *   npx ts-node scripts/check-mints.ts
 *   RPC_URL=<your mainnet rpc> npx ts-node scripts/check-mints.ts
 *
 * Writes the result to scripts/mints.mainnet.json so the deploy script can read it.
 *
 * A transfer fee or a transfer hook is the blocker: Gali's pools assume the amount
 * sent equals the amount received. Either of those breaks the accounting.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { getMint, getTransferFeeConfig, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getExtensionTypes } from '@solana/spl-token';
import { writeFileSync } from 'fs';

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

const MINTS: Record<string, string> = {
  ORE: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
  SKR: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
};

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const out: Record<string, unknown> = { rpc: RPC, checkedAt: new Date().toISOString() };
  let blocked = false;

  for (const [name, addr] of Object.entries(MINTS)) {
    const key = new PublicKey(addr);
    const info = await conn.getAccountInfo(key);
    if (!info) {
      console.log(`${name}  NOT FOUND at ${addr}`);
      out[name] = { address: addr, found: false };
      blocked = true;
      continue;
    }
    const is2022 = info.owner.equals(TOKEN_2022_PROGRAM_ID);
    const program = is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const mint = await getMint(conn, key, 'confirmed', program);

    let extensions: string[] = [];
    let transferFeeBps: number | null = null;
    if (is2022) {
      try {
        extensions = getExtensionTypes(info.data.subarray(165)).map(String);
      } catch {
        extensions = ['<could not parse>'];
      }
      const fee = getTransferFeeConfig(mint);
      if (fee) transferFeeBps = fee.newerTransferFee.transferFeeBasisPoints;
    }

    const row = {
      address: addr,
      found: true,
      tokenProgram: is2022 ? 'Token-2022' : 'Token',
      decimals: mint.decimals,
      supply: mint.supply.toString(),
      mintAuthority: mint.mintAuthority?.toBase58() ?? null,
      freezeAuthority: mint.freezeAuthority?.toBase58() ?? null,
      extensions,
      transferFeeBps,
    };
    out[name] = row;

    console.log(`\n${name}  ${addr}`);
    console.log(`  token program   ${row.tokenProgram}`);
    console.log(`  decimals        ${row.decimals}`);
    console.log(`  mint authority  ${row.mintAuthority ?? 'none (fixed supply)'}`);
    console.log(`  freeze auth     ${row.freezeAuthority ?? 'none'}`);
    if (is2022) console.log(`  extensions      ${extensions.join(', ') || 'none'}`);
    if (transferFeeBps !== null) console.log(`  TRANSFER FEE    ${transferFeeBps} bps`);

    if (transferFeeBps) {
      console.log(`  >> BLOCKER: a transfer fee breaks pool accounting.`);
      blocked = true;
    }
    if (row.freezeAuthority) {
      console.log(`  >> WARNING: a freeze authority can freeze Gali's pool accounts.`);
    }
  }

  writeFileSync('scripts/mints.mainnet.json', JSON.stringify(out, null, 2) + '\n');
  console.log(`\nwritten to scripts/mints.mainnet.json`);
  console.log(blocked ? '\nRESULT: blocked, see the lines marked BLOCKER above.' : '\nRESULT: both mints are safe for the pools.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
