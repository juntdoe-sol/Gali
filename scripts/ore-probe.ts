/**
 * Checks Gali's picture of ORE's byte layout against the live program.
 *
 *   npx ts-node scripts/ore-probe.ts
 *   RPC_URL=<your mainnet rpc> npx ts-node scripts/ore-probe.ts
 *
 * Why this exists: ORE is built with Steel, so there is no IDL to generate a client
 * from, and the idl.json in their repo is out of date (it omits accounts the program
 * actually requires). The decoders in app/src/chain/ore/accounts.ts are therefore
 * hand-written, and this script is what keeps them honest.
 *
 * Every ORE struct is #[repr(C)] and built from u64, i64, Pubkey and fixed arrays, so
 * each account is one fixed size. If a size still matches, the offsets inside it
 * cannot have moved without a field being swapped for another of the same width. The
 * decoded values are printed as well, so a swap of that kind shows up as nonsense: a
 * round id in the trillions, SOL totals larger than the supply, a fee collector that
 * is not the treasury.
 *
 * Run it after ORE redeploys, and before any mainnet work that depends on reading
 * their accounts.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { writeFileSync } from 'fs';

/**
 * The default public RPC rejects this program's reads, so point at one that serves
 * them. Any mainnet endpoint works; there is no devnet deployment of ORE.
 */
const RPC = process.env.RPC_URL || 'https://solana-rpc.publicnode.com';

const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
const BOARD_ADDRESS = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');
const CONFIG_ADDRESS = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');
const TREASURY_ADDRESS = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
const VAR_ADDRESS = new PublicKey('BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E');

/** Steel puts an 8-byte discriminator in front of every account. */
const DISC = 8;

/** Expected sizes, discriminator included. */
const SIZE = {
  board: DISC + 32,
  round: DISC + 944,
  miner: DISC + 744,
  config: DISC + 224,
  treasury: DISC + 40,
  automation: DISC + 152,
};

const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(DISC + o);
const key = (b: Buffer, o: number) => new PublicKey(b.subarray(DISC + o, DISC + o + 32)).toBase58();
const sol = (n: bigint) => (Number(n) / 1e9).toFixed(4);
const ore = (n: bigint) => (Number(n) / 1e11).toFixed(4);

const u64le = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
};

/**
 * Gali's copy of ORE's solo/split rule, kept in step with app/src/chain/ore/accounts.ts.
 * Duplicated rather than imported so this script stays runnable on its own.
 */
const distributionMask = (roundId: bigint) => {
  let randomness: Uint8Array = keccak_256(u64le(roundId));
  let offset = 0;
  const indices = Array.from({ length: 25 }, (_, i) => i);
  for (let i = 24; i >= 1; i--) {
    if (offset + 2 > randomness.length) {
      randomness = keccak_256(randomness);
      offset = 0;
    }
    const j = (randomness[offset] | (randomness[offset + 1] << 8)) % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
    offset += 2;
  }
  let mask = 0;
  for (const idx of indices.slice(0, 10)) mask |= 1 << idx;
  return mask >>> 0;
};

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const out: Record<string, unknown> = { rpc: RPC, checkedAt: new Date().toISOString(), disc: DISC };
  const problems: string[] = [];

  const expect = (what: string, got: number, want: number) => {
    console.log(`${what.padEnd(11)} ${got} bytes (expected ${want})`);
    if (got !== want) problems.push(`${what} is ${got} bytes, not ${want}`);
  };

  const [boardInfo, configInfo, treasuryInfo, varInfo] = await conn.getMultipleAccountsInfo([
    BOARD_ADDRESS,
    CONFIG_ADDRESS,
    TREASURY_ADDRESS,
    VAR_ADDRESS,
  ]);
  if (!boardInfo) throw new Error('Board account not found. Wrong RPC or wrong cluster?');
  if (!configInfo || !treasuryInfo) throw new Error('Config or treasury not found. Wrong cluster?');

  const board = boardInfo.data;
  expect('Board', board.length, SIZE.board);
  const roundId = u64(board, 0);
  const startSlot = u64(board, 8);
  const endSlot = u64(board, 16);
  console.log(`  round_id ${roundId}`);
  console.log(
    endSlot === 18446744073709551615n
      ? '  round has not started: waiting for its first deploy'
      : `  slots ${startSlot}..${endSlot} (${endSlot - startSlot} per round)`,
  );
  console.log(`  production_cost_ema ${sol(u64(board, 24))} SOL per ORE`);

  const config = configInfo.data;
  expect('Config', config.length, SIZE.config);
  const roundSlots = u64(config, 152);
  console.log(`  round_slots ${roundSlots}  intermission_slots ${u64(config, 144)}`);
  console.log(`  admin fee ${u64(config, 64)} bps  protocol fee ${u64(config, 136)} bps`);
  console.log(`  protocol fee collector ${key(config, 104)}`);
  if (key(config, 104) !== TREASURY_ADDRESS.toBase58()) {
    problems.push('protocol fee collector is not the treasury, so the Config offsets are off');
  }

  const treasury = treasuryInfo.data;
  expect('Treasury', treasury.length, SIZE.treasury);
  console.log(`  motherlode ${ore(u64(treasury, 0))} ORE`);
  console.log(`  refined ${ore(u64(treasury, 24))} ORE  unrefined ${ore(u64(treasury, 32))} ORE`);

  // entropy-api has no published id, but it owns the var account ORE points at.
  if (varInfo) {
    console.log(`\nentropy program ${varInfo.owner.toBase58()}`);
    out.entropyProgramId = varInfo.owner.toBase58();
    if (varInfo.owner.toBase58() !== '3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X') {
      problems.push('the var account changed owner, so ENTROPY_PROGRAM_ID in consts.ts is stale');
    }
  }

  // The round before the current one has settled, so its result is readable.
  const probeRound = roundId > 0n ? roundId - 1n : roundId;
  const roundPda = PublicKey.findProgramAddressSync(
    [Buffer.from('round'), u64le(probeRound)],
    ORE_PROGRAM_ID,
  )[0];
  const roundInfo = await conn.getAccountInfo(roundPda);
  if (!roundInfo) {
    console.log(`\nRound ${probeRound} is already closed. Run again and it should be there.`);
  } else {
    const r = roundInfo.data;
    console.log('');
    expect('Round', r.length, SIZE.round);
    const deployed = Array.from({ length: 25 }, (_, i) => u64(r, 8 + i * 8));
    console.log(`  id ${u64(r, 0)}  miners ${u64(r, 904)}`);
    console.log(`  deployed ${sol(deployed.reduce((a, b) => a + b, 0n))} SOL over 25 squares`);
    console.log(`  returned ${sol(u64(r, 896))} SOL  kept ${sol(u64(r, 888))} SOL`);
    console.log(`  rewards ${ore(Array.from({ length: 25 }, (_, i) => u64(r, 688 + i * 8)).reduce((a, b) => a + b, 0n))} ORE`);
    const top = key(r, 912);
    console.log(`  winner ${top}${top === 'SpLiT11111111111111111111111111111111111112' ? '  (split between the square)' : ''}`);
    if (u64(r, 0) !== probeRound) problems.push('the round id does not match its own PDA, so the Round offsets are off');

    // The settled round also proves out Gali's copy of the solo/split rule. ORE picks
    // the winning square by xoring the four words of the entropy and taking it mod 25,
    // then splits the reward when that square's bit is clear.
    const entropy = r.subarray(DISC + 608, DISC + 640);
    if (!entropy.every((b) => b === 0)) {
      let rng = 0n;
      for (let i = 0; i < 4; i++) rng ^= entropy.readBigUInt64LE(i * 8);
      const square = Number(rng % 25n);
      const predictedSplit = (distributionMask(probeRound) & (1 << square)) === 0;
      const actualSplit = top === 'SpLiT11111111111111111111111111111111111112';
      console.log(`  square ${square}, predicted ${predictedSplit ? 'split' : 'solo'}, chain says ${actualSplit ? 'split' : 'solo'}`);
      if (predictedSplit !== actualSplit) {
        problems.push(`the solo/split prediction for round ${probeRound} is wrong, so distributionMask no longer matches ORE`);
      }
    }

    // A real miner, to size the Miner account. The rent payer started this round, so
    // they certainly have one; top_miner is the split marker on split rounds.
    const authority = new PublicKey(r.subarray(DISC + 656, DISC + 688));
    const minerPda = PublicKey.findProgramAddressSync(
      [Buffer.from('miner'), authority.toBuffer()],
      ORE_PROGRAM_ID,
    )[0];
    const minerInfo = await conn.getAccountInfo(minerPda);
    if (minerInfo) {
      const m = minerInfo.data;
      console.log('');
      expect('Miner', m.length, SIZE.miner);
      console.log(`  authority ${key(m, 0)}`);
      console.log(`  round ${u64(m, 656)}  checkpointed ${u64(m, 40)}`);
      console.log(`  claimable ${sol(u64(m, 680))} SOL, ${ore(u64(m, 688))} ORE refined, ${ore(u64(m, 696))} ORE unrefined`);
      console.log(`  lifetime deployed ${sol(u64(m, 728))} SOL`);
      if (key(m, 0) !== authority.toBase58()) {
        problems.push('the miner authority does not match its own PDA seed, so the Miner offsets are off');
      }

      const autoPda = PublicKey.findProgramAddressSync(
        [Buffer.from('automation'), authority.toBuffer()],
        ORE_PROGRAM_ID,
      )[0];
      const autoInfo = await conn.getAccountInfo(autoPda);
      if (autoInfo) {
        const a = autoInfo.data;
        console.log('');
        expect('Automation', a.length, SIZE.automation);
        console.log(`  executor ${key(a, 48)}  fee ${sol(u64(a, 80))} SOL per deploy`);
        console.log(`  ${sol(u64(a, 0))} SOL per square, ${sol(u64(a, 40))} SOL left`);
        if (key(a, 8) !== authority.toBase58()) {
          problems.push('the automation authority does not match its own PDA seed, so the Automation offsets are off');
        }
      } else {
        console.log('\nAutomation  this miner has none, so its size went unchecked');
      }
    }
  }

  out.sizes = SIZE;
  out.problems = problems;
  out.ok = problems.length === 0;
  writeFileSync('scripts/ore-layout.json.checked', JSON.stringify(out, null, 2) + '\n');

  if (problems.length === 0) {
    console.log('\nRESULT: everything matched. The decoders are good.');
  } else {
    console.log('\nRESULT: ORE has changed.');
    for (const p of problems) console.log(`  - ${p}`);
    console.log('Fix app/src/chain/ore/accounts.ts and scripts/ore-layout.json before touching mainnet.');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
