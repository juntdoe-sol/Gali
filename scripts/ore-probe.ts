/**
 * Probes ORE's live accounts on mainnet to pin down their byte layout.
 *
 *   npx ts-node scripts/ore-probe.ts
 *   RPC_URL=<your mainnet rpc> npx ts-node scripts/ore-probe.ts
 *
 * Why this exists: ORE is built with Steel, so there is no IDL. Every field in
 * Board, Round, Miner and Automation is a fixed-size integer or a 32-byte key
 * except Miner.rewards_factor, whose type comes from Steel. That one unknown is
 * recovered from the real account length, and the rest is then arithmetic.
 *
 * The decoded values are printed so they can be eyeballed. If the offsets were
 * wrong the numbers would be obvious nonsense: a round id in the trillions, SOL
 * totals that dwarf the supply, a top miner that is all zeroes on a played round.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { writeFileSync } from 'fs';

const RPC = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
const BOARD_ADDRESS = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');

/** Steel puts an 8-byte discriminator in front of every account. */
const DISC = 8;

const u64 = (b: Buffer, o: number) => b.readBigUInt64LE(o);
const key = (b: Buffer, o: number) => new PublicKey(b.subarray(o, o + 32)).toBase58();
const arr25 = (b: Buffer, o: number) => Array.from({ length: 25 }, (_, i) => u64(b, o + i * 8));

/** Board: round_id, start_slot, end_slot, production_cost_ema. */
const BOARD = { round_id: 0, start_slot: 8, end_slot: 16, production_cost_ema: 24, SIZE: 32 };

/** Round, in declaration order. All u64 or fixed byte arrays, so no padding. */
const ROUND = {
  id: 0,
  deployed: 8,
  mass: 208,
  count: 408,
  slot_hash: 608,
  expires_at: 640,
  motherlode: 648,
  rent_payer: 656,
  rewards: 688,
  total_vaulted: 888,
  total_returned_sol: 896,
  total_miners: 904,
  top_miner: 912,
  SIZE: 944,
};

/** Miner up to the unknown, then everything after it shifted by sizeof(Numeric). */
const MINER_HEAD = {
  authority: 0,
  auto_return: 32,
  checkpoint_id: 40,
  checkpoint_fee: 48,
  deployed: 56,
  mass: 256,
  cumulative: 456,
  round_id: 656,
  rewards_factor: 664,
};
const MINER_TAIL = [
  'rewards_sol',
  'refined_ore',
  'rewards_ore',
  'last_claim_ore_at',
  'last_claim_sol_at',
  'lifetime_rewards_ore',
  'lifetime_deployed',
  'lifetime_rewards_sol',
];

const AUTOMATION = {
  amount: 0,
  authority: 8,
  balance: 40,
  executor: 48,
  fee: 80,
  strategy: 88,
  mask: 96,
  reload: 104,
  total_sol_spent: 112,
  total_ore_earned: 120,
  conditions: 128,
  SIZE: 152,
};

const sol = (n: bigint) => (Number(n) / 1e9).toFixed(4);
const ore = (n: bigint) => (Number(n) / 1e11).toFixed(4);

async function main() {
  const conn = new Connection(RPC, 'confirmed');
  const out: Record<string, unknown> = { rpc: RPC, checkedAt: new Date().toISOString(), disc: DISC };
  let ok = true;

  const boardInfo = await conn.getAccountInfo(BOARD_ADDRESS);
  if (!boardInfo) throw new Error('Board account not found. Wrong RPC or wrong cluster?');
  const board = boardInfo.data;
  console.log(`Board  ${boardInfo.data.length} bytes (expected ${DISC + BOARD.SIZE})`);
  if (board.length !== DISC + BOARD.SIZE) {
    console.log('  >> SIZE MISMATCH, the Board layout is wrong');
    ok = false;
  }
  const roundId = u64(board, DISC + BOARD.round_id);
  const startSlot = u64(board, DISC + BOARD.start_slot);
  const endSlot = u64(board, DISC + BOARD.end_slot);
  console.log(`  round_id ${roundId}`);
  console.log(`  start_slot ${startSlot}  end_slot ${endSlot}  (${endSlot - startSlot} slots per round)`);
  console.log(`  production_cost_ema ${sol(u64(board, DISC + BOARD.production_cost_ema))} SOL per ORE`);
  out.board = {
    size: board.length,
    roundId: roundId.toString(),
    startSlot: startSlot.toString(),
    endSlot: endSlot.toString(),
    roundSlots: (endSlot - startSlot).toString(),
  };

  const u64le = (n: bigint) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(n);
    return b;
  };
  // the previous round has finished, so its result is settled and readable
  const probeRound = roundId > 0n ? roundId - 1n : roundId;
  const roundPda = PublicKey.findProgramAddressSync(
    [Buffer.from('round'), u64le(probeRound)],
    ORE_PROGRAM_ID,
  )[0];
  const roundInfo = await conn.getAccountInfo(roundPda);
  if (!roundInfo) {
    console.log(`\nRound ${probeRound} not found (closed already). Try again mid-round.`);
  } else {
    const r = roundInfo.data;
    console.log(`\nRound  ${r.length} bytes (expected ${DISC + ROUND.SIZE})  id ${u64(r, DISC + ROUND.id)}`);
    if (r.length !== DISC + ROUND.SIZE) {
      console.log('  >> SIZE MISMATCH, the Round layout is wrong');
      ok = false;
    }
    const deployed = arr25(r, DISC + ROUND.deployed);
    const total = deployed.reduce((a, b) => a + b, 0n);
    console.log(`  total deployed ${sol(total)} SOL across 25 squares`);
    console.log(`  total_miners ${u64(r, DISC + ROUND.total_miners)}`);
    console.log(`  total_returned_sol ${sol(u64(r, DISC + ROUND.total_returned_sol))} SOL`);
    console.log(`  motherlode ${ore(u64(r, DISC + ROUND.motherlode))} ORE`);
    console.log(`  top_miner ${key(r, DISC + ROUND.top_miner)}`);
    out.round = {
      size: r.length,
      id: u64(r, DISC + ROUND.id).toString(),
      totalDeployedLamports: total.toString(),
      totalMiners: u64(r, DISC + ROUND.total_miners).toString(),
      topMiner: key(r, DISC + ROUND.top_miner),
    };

    // a real miner to size the Miner account with
    const topMiner = new PublicKey(r.subarray(DISC + ROUND.top_miner, DISC + ROUND.top_miner + 32));
    if (!topMiner.equals(PublicKey.default)) {
      const minerPda = PublicKey.findProgramAddressSync(
        [Buffer.from('miner'), topMiner.toBuffer()],
        ORE_PROGRAM_ID,
      )[0];
      const minerInfo = await conn.getAccountInfo(minerPda);
      if (minerInfo) {
        const m = minerInfo.data;
        const numeric = m.length - DISC - (MINER_HEAD.rewards_factor + MINER_TAIL.length * 8);
        console.log(`\nMiner  ${m.length} bytes  =>  sizeof(Numeric) = ${numeric}`);
        const tail: Record<string, number> = {};
        MINER_TAIL.forEach((name, i) => {
          tail[name] = MINER_HEAD.rewards_factor + numeric + i * 8;
        });
        console.log(`  authority ${key(m, DISC + MINER_HEAD.authority)}`);
        console.log(`  round_id ${u64(m, DISC + MINER_HEAD.round_id)}`);
        console.log(`  rewards_sol ${sol(u64(m, DISC + tail.rewards_sol))} SOL`);
        console.log(`  rewards_ore ${ore(u64(m, DISC + tail.rewards_ore))} ORE unrefined`);
        console.log(`  refined_ore ${ore(u64(m, DISC + tail.refined_ore))} ORE refined`);
        console.log(`  lifetime_deployed ${sol(u64(m, DISC + tail.lifetime_deployed))} SOL`);
        if (numeric <= 0 || numeric % 8 !== 0) {
          console.log('  >> Numeric size looks wrong, the Miner layout is off');
          ok = false;
        }
        if (key(m, DISC + MINER_HEAD.authority) !== topMiner.toBase58()) {
          console.log('  >> authority does not match the miner PDA seed, layout is off');
          ok = false;
        }
        out.miner = { size: m.length, numericSize: numeric, offsets: { ...MINER_HEAD, ...tail } };

        const autoPda = PublicKey.findProgramAddressSync(
          [Buffer.from('automation'), topMiner.toBuffer()],
          ORE_PROGRAM_ID,
        )[0];
        const autoInfo = await conn.getAccountInfo(autoPda);
        if (autoInfo) {
          const a = autoInfo.data;
          console.log(`\nAutomation  ${a.length} bytes (expected ${DISC + AUTOMATION.SIZE})`);
          if (a.length !== DISC + AUTOMATION.SIZE) {
            console.log('  >> SIZE MISMATCH, the Automation layout is wrong');
            ok = false;
          }
          console.log(`  authority ${key(a, DISC + AUTOMATION.authority)}`);
          console.log(`  executor  ${key(a, DISC + AUTOMATION.executor)}`);
          console.log(`  amount ${sol(u64(a, DISC + AUTOMATION.amount))} SOL per square`);
          console.log(`  balance ${sol(u64(a, DISC + AUTOMATION.balance))} SOL`);
          console.log(`  fee ${sol(u64(a, DISC + AUTOMATION.fee))} SOL to the executor`);
          out.automation = {
            size: a.length,
            executor: key(a, DISC + AUTOMATION.executor),
            feeLamports: u64(a, DISC + AUTOMATION.fee).toString(),
          };
        } else {
          console.log('\nAutomation  none for this miner (they deploy by hand)');
        }
      }
    }
  }

  out.layout = { BOARD, ROUND, MINER_HEAD, MINER_TAIL, AUTOMATION };
  out.ok = ok;
  writeFileSync('scripts/ore-layout.json', JSON.stringify(out, null, 2) + '\n');
  console.log(`\nwritten to scripts/ore-layout.json`);
  console.log(ok ? '\nRESULT: every size matched, the layout is confirmed.' : '\nRESULT: something did not match, see the lines marked >>.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
