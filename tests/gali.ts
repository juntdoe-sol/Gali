/**
 * Gali's tests, against the ORE-backed program.
 *
 * Gali no longer runs a round, so there is no round to test. What is worth testing
 * is the seam: does the program read ORE's accounts correctly, does it award the
 * right points off them, does the SKR jackpot split the way ORE split the ORE, and
 * does it refuse what it should refuse.
 *
 * ORE's accounts are fabricated by the `ore-mock` program, deployed at ORE's own
 * address on the validator. That makes rare cases reachable: ORE's motherlode hits
 * one round in 500, and a named wallet taking a solo square is rarer still. It does
 * not prove Gali works against the real ORE program, only that it reads the layout
 * right and does the right arithmetic on it. The layout itself is checked against
 * mainnet separately, by scripts/ore-probe.ts.
 */
import * as anchor from '@coral-xyz/anchor';
import {
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import galiIdl from '../target/idl/gali.json';
import oreIdl from '../target/idl/ore_mock.json';
import {
  boardBytes,
  minerBytes,
  oreBoardPda,
  oreMinerPda,
  oreRoundPda,
  roundBytes,
  zeros25,
} from './ore-fixtures';

const BN = anchor.BN;
const SKR_DECIMALS = 6;
const ORE_DECIMALS = 11;

/** One whole token in its own smallest unit. */
const whole = (n: number, decimals: number) => BigInt(Math.round(n * 10 ** decimals));

describe('gali on ORE', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(galiIdl as anchor.Idl, provider);
  const ore = new anchor.Program(oreIdl as anchor.Idl, provider);
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const config = find(Buffer.from('config'));
  const treasury = find(Buffer.from('treasury'));
  const motherlode = find(Buffer.from('motherlode'));
  const vault = find(Buffer.from('vault'));
  const oreTreasury = find(Buffer.from('ore_treasury'));
  const oreMotherlode = find(Buffer.from('ore_motherlode'));
  const oreVault = find(Buffer.from('ore_vault'));
  const playerPda = (owner: PublicKey) => find(Buffer.from('player'), owner.toBuffer());
  const jackpotPda = (roundId: number) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(roundId));
    return find(Buffer.from('jackpot'), b);
  };
  const acc = program.account as any;

  let skrMint: PublicKey;
  let oreMint: PublicKey;

  /** $3.60, $36 and $270 in millionths of a dollar: the shop's cheapest, middle and dearest. */
  const GEAR_USD = [3_600_000, 36_000_000, 270_000_000];
  /** 1 SKR = $0.018, 1 ORE = $61. */
  const SKR_MICRO = 18_000;
  const ORE_MICRO = 61_000_000;

  const balance = async (ata: PublicKey) => (await getAccount(conn, ata)).amount;

  /** ConfigUpdate is one struct of Options, so absent fields go on the wire as null. */
  const configUpdate = (patch: Record<string, unknown>) => ({
    basePoints: null,
    motherlodePoints: null,
    boostTier1: null,
    boostTier2: null,
    oreBoostTier1: null,
    oreBoostTier2: null,
    gearPricesUsd: null,
    priceMaxAgeSecs: null,
    motherlodePoolBps: null,
    oreMotherlodeBps: null,
    ...patch,
  });

  async function fundedPlayer() {
    const kp = Keypair.generate();
    const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, 'confirmed');
    const skrAta = (await getOrCreateAssociatedTokenAccount(conn, admin, skrMint, kp.publicKey)).address;
    const oreAta = (await getOrCreateAssociatedTokenAccount(conn, admin, oreMint, kp.publicKey)).address;
    await mintTo(conn, admin, skrMint, skrAta, admin, 5_000_000 * 10 ** SKR_DECIMALS);
    await mintTo(conn, admin, oreMint, oreAta, admin, Number(whole(50, ORE_DECIMALS)));
    await program.methods
      .initPlayer()
      .accountsStrict({
        owner: kp.publicKey,
        player: playerPda(kp.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .signers([kp])
      .rpc();
    return { kp, skrAta, oreAta };
  }

  const setBoard = (roundId: number) =>
    ore.methods
      .putBoard(Buffer.from(boardBytes({ roundId })))
      .accountsStrict({
        payer: admin.publicKey,
        account: oreBoardPda(),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const setRound = (f: Parameters<typeof roundBytes>[0]) =>
    ore.methods
      .putRound(new BN(f.id), Buffer.from(roundBytes(f)))
      .accountsStrict({
        payer: admin.publicKey,
        account: oreRoundPda(f.id),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const setMiner = (f: Parameters<typeof minerBytes>[0]) =>
    ore.methods
      .putMiner(f.authority, Buffer.from(minerBytes(f)))
      .accountsStrict({
        payer: admin.publicKey,
        account: oreMinerPda(f.authority),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

  const recordRound = (owner: PublicKey, roundId: number) =>
    program.methods
      .recordOreRound(new BN(roundId))
      .accountsStrict({
        cranker: admin.publicKey,
        config,
        player: playerPda(owner),
        oreBoard: oreBoardPda(),
        oreRound: oreRoundPda(roundId),
        oreMiner: oreMinerPda(owner),
      })
      .rpc();

  const buySkr = (kp: Keypair, ata: PublicKey, item: number) =>
    program.methods
      .buyGear(item)
      .accountsStrict({
        owner: kp.publicKey,
        config,
        player: playerPda(kp.publicKey),
        skrMint,
        userAta: ata,
        treasury,
        motherlode,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

  before(async () => {
    skrMint = await createMint(conn, admin, admin.publicKey, null, SKR_DECIMALS);
    oreMint = await createMint(conn, admin, admin.publicKey, null, ORE_DECIMALS);

    await program.methods
      .initConfig({
        basePoints: new BN(10),
        motherlodePoints: new BN(500),
        boostTier1: new BN(5_000 * 10 ** SKR_DECIMALS),
        boostTier2: new BN(50_000 * 10 ** SKR_DECIMALS),
        oreBoostTier1: new BN(whole(1, ORE_DECIMALS).toString()),
        oreBoostTier2: new BN(whole(10, ORE_DECIMALS).toString()),
        gearPricesUsd: GEAR_USD.map((v) => new BN(v)),
        skrPriceMicro: new BN(SKR_MICRO),
        orePriceMicro: new BN(ORE_MICRO),
        priceMaxAgeSecs: 0,
        motherlodePoolBps: 7_000,
        oreMotherlodeBps: 5_000,
      })
      .accountsStrict({
        authority: admin.publicKey,
        program: program.programId,
        programData: PublicKey.findProgramAddressSync(
          [program.programId.toBuffer()],
          new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
        )[0],
        config,
        skrMint,
        vault,
        treasury,
        motherlode,
        oreMint,
        oreVault,
        oreTreasury,
        oreMotherlode,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  describe('gear is priced in dollars', () => {
    it('charges the SKR that dollar price works out to, and sends 70% to the jackpot', async () => {
      const { kp, skrAta } = await fundedPlayer();
      const before = await balance(skrAta);
      const poolBefore = await balance(motherlode);
      const treasuryBefore = await balance(treasury);

      await buySkr(kp, skrAta, 1);

      // $36 at $0.018 a SKR is 2,000 SKR.
      const spent = before - (await balance(skrAta));
      expect(spent).to.equal(BigInt(2_000 * 10 ** SKR_DECIMALS));
      expect((await balance(motherlode)) - poolBefore).to.equal(BigInt(1_400 * 10 ** SKR_DECIMALS));
      expect((await balance(treasury)) - treasuryBefore).to.equal(BigInt(600 * 10 ** SKR_DECIMALS));
    });

    it('charges the ORE the same dollar price works out to', async () => {
      const { kp, oreAta } = await fundedPlayer();
      const before = await balance(oreAta);

      await program.methods
        .buyGearOre(1)
        .accountsStrict({
          owner: kp.publicKey,
          config,
          player: playerPda(kp.publicKey),
          oreMint,
          userAta: oreAta,
          oreTreasury,
          oreMotherlode,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp])
        .rpc();

      const spent = before - (await balance(oreAta));
      const expected = (BigInt(GEAR_USD[1]) * 10n ** BigInt(ORE_DECIMALS)) / BigInt(ORE_MICRO);
      expect(spent).to.equal(expected);
      // ORE splits on its own knob: half the jackpot, half the platform.
      expect(await balance(oreMotherlode)).to.equal(expected / 2n);
      expect(await balance(oreTreasury)).to.equal(expected - expected / 2n);
      // The same $36, so neither token is the cheap way in.
      const asUsd = (Number(spent) / 10 ** ORE_DECIMALS) * (ORE_MICRO / 1_000_000);
      expect(asUsd).to.be.closeTo(36, 0.0001);
    });

    it('refuses a sale priced off a rate nobody has refreshed', async () => {
      await program.methods
        .updateConfig(configUpdate({ priceMaxAgeSecs: 1 }) as any)
        .accountsStrict({ authority: admin.publicKey, config })
        .rpc();
      await new Promise((r) => setTimeout(r, 2_500));

      const { kp, skrAta } = await fundedPlayer();
      try {
        await buySkr(kp, skrAta, 2);
        expect.fail('a stale rate should close the shop');
      } catch (e) {
        expect(String(e)).to.match(/PriceStale/);
      }

      await program.methods
        .setTokenPrices(new BN(SKR_MICRO), new BN(ORE_MICRO))
        .accountsStrict({ authority: admin.publicKey, config })
        .rpc();
      await buySkr(kp, skrAta, 2); // refreshing re-opens it

      await program.methods
        .updateConfig(configUpdate({ priceMaxAgeSecs: 0 }) as any)
        .accountsStrict({ authority: admin.publicKey, config })
        .rpc();
    });
  });

  describe('recording a round played on ORE', () => {
    it('awards points for a win and none for a loss', async () => {
      const winner = await fundedPlayer();
      const loser = await fundedPlayer();
      const roundId = 1_000;
      const deployed = zeros25();
      deployed[7] = 3 * LAMPORTS_PER_SOL;
      deployed[8] = 1 * LAMPORTS_PER_SOL;

      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 7, totalMiners: 2, endSlot: 10 });

      const wMine = zeros25();
      wMine[7] = 1 * LAMPORTS_PER_SOL;
      await setMiner({ authority: winner.kp.publicKey, roundId, deployed: wMine });
      const lMine = zeros25();
      lMine[8] = 1 * LAMPORTS_PER_SOL;
      await setMiner({ authority: loser.kp.publicKey, roundId, deployed: lMine });

      await recordRound(winner.kp.publicKey, roundId);
      await recordRound(loser.kp.publicKey, roundId);

      const w = await acc.player.fetch(playerPda(winner.kp.publicKey));
      const l = await acc.player.fetch(playerPda(loser.kp.publicKey));
      // One square covered, so the full scaling applies: 10 base * 25 / 1.
      expect(w.points.toNumber()).to.equal(250);
      expect(w.wins).to.equal(1);
      expect(l.points.toNumber()).to.equal(0);
      // Both played, so both get the round and the day streak.
      expect(l.rounds).to.equal(1);
      expect(l.streak).to.equal(1);
    });

    it('scales points down as more squares are covered', async () => {
      const p = await fundedPlayer();
      const roundId = 1_010;
      const deployed = zeros25().map(() => LAMPORTS_PER_SOL);
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 3, endSlot: 10 });
      const mine = zeros25();
      for (let i = 0; i < 5; i++) mine[i] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await recordRound(p.kp.publicKey, roundId);
      expect((await acc.player.fetch(playerPda(p.kp.publicKey))).points.toNumber()).to.equal(50);
    });

    it('adds the motherlode points when ORE hit its motherlode', async () => {
      const p = await fundedPlayer();
      const roundId = 1_020;
      const deployed = zeros25();
      deployed[4] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({
        id: roundId,
        deployed,
        winningSquare: 4,
        motherlode: whole(3, ORE_DECIMALS),
        endSlot: 10,
      });
      const mine = zeros25();
      mine[4] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await recordRound(p.kp.publicKey, roundId);
      expect((await acc.player.fetch(playerPda(p.kp.publicKey))).points.toNumber()).to.equal(750);
    });

    it('records a round only once', async () => {
      const p = await fundedPlayer();
      const roundId = 1_030;
      const deployed = zeros25();
      deployed[1] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 1, endSlot: 10 });
      const mine = zeros25();
      mine[1] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await recordRound(p.kp.publicKey, roundId);
      try {
        await recordRound(p.kp.publicKey, roundId);
        expect.fail('a round should pay points once');
      } catch (e) {
        expect(String(e)).to.match(/OreRoundAlreadyRecorded/);
      }
    });

    it('refuses the live round', async () => {
      const p = await fundedPlayer();
      const roundId = 1_040;
      const deployed = zeros25();
      deployed[2] = LAMPORTS_PER_SOL;
      await setBoard(roundId); // the round asked about is the one still running
      await setRound({ id: roundId, deployed, winningSquare: 2, endSlot: 10 });
      const mine = zeros25();
      mine[2] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      try {
        await recordRound(p.kp.publicKey, roundId);
        expect.fail('a live round has no settled result to award from');
      } catch (e) {
        expect(String(e)).to.match(/OreRoundStillLive/);
      }
    });

    it('refuses a round ORE has not drawn', async () => {
      const p = await fundedPlayer();
      const roundId = 1_050;
      const deployed = zeros25();
      deployed[2] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, endSlot: 10 }); // entropy still zero
      const mine = zeros25();
      mine[2] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      try {
        await recordRound(p.kp.publicKey, roundId);
        expect.fail('an undrawn round has no result');
      } catch (e) {
        expect(String(e)).to.match(/OreRoundUnsettled/);
      }
    });

    it('refuses a miner ORE has not checkpointed', async () => {
      const p = await fundedPlayer();
      const roundId = 1_060;
      const deployed = zeros25();
      deployed[5] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 5, endSlot: 10 });
      const mine = zeros25();
      mine[5] = LAMPORTS_PER_SOL;
      await setMiner({
        authority: p.kp.publicKey,
        roundId,
        deployed: mine,
        checkpointId: roundId - 1,
      });

      try {
        await recordRound(p.kp.publicKey, roundId);
        expect.fail('an unsettled miner has no final result');
      } catch (e) {
        expect(String(e)).to.match(/OreNotCheckpointed/);
      }
    });
  });

  describe('the SKR jackpot', () => {
    const fundJackpot = async (wholeSkr: number) => {
      const ata = (await getOrCreateAssociatedTokenAccount(conn, admin, skrMint, admin.publicKey)).address;
      await mintTo(conn, admin, skrMint, ata, admin, wholeSkr * 10 ** SKR_DECIMALS);
      await program.methods
        .fundMotherlode(new BN(wholeSkr * 10 ** SKR_DECIMALS))
        .accountsStrict({
          funder: admin.publicKey,
          config,
          skrMint,
          funderAta: ata,
          motherlode,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    };

    const claim = (owner: Keypair, skrAta: PublicKey, oreAta: PublicKey, roundId: number) =>
      program.methods
        .claimJackpot(new BN(roundId))
        .accountsStrict({
          owner: owner.publicKey,
          config,
          player: playerPda(owner.publicKey),
          jackpot: jackpotPda(roundId),
          skrMint,
          oreMint,
          motherlode,
          oreMotherlode,
          ownerSkr: skrAta,
          ownerOre: oreAta,
          oreBoard: oreBoardPda(),
          oreRound: oreRoundPda(roundId),
          oreMiner: oreMinerPda(owner.publicKey),
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([owner])
        .rpc();

    it('splits by the same share of the square ORE used, from a pool frozen at the first claim', async () => {
      const big = await fundedPlayer();
      const small = await fundedPlayer();
      const roundId = 2_000;
      const deployed = zeros25();
      deployed[9] = 4 * LAMPORTS_PER_SOL; // 3 SOL one, 1 SOL the other
      await setBoard(roundId + 1);
      await setRound({
        id: roundId,
        deployed,
        winningSquare: 9,
        motherlode: whole(5, ORE_DECIMALS),
        endSlot: 10,
      });
      const a = zeros25();
      a[9] = 3 * LAMPORTS_PER_SOL;
      await setMiner({ authority: big.kp.publicKey, roundId, deployed: a });
      const b = zeros25();
      b[9] = 1 * LAMPORTS_PER_SOL;
      await setMiner({ authority: small.kp.publicKey, roundId, deployed: b });

      const poolBefore = await balance(motherlode);
      const orePoolBefore = await balance(oreMotherlode);
      const bigBefore = await balance(big.skrAta);
      const smallBefore = await balance(small.skrAta);
      const bigOreBefore = await balance(big.oreAta);

      await claim(big.kp, big.skrAta, big.oreAta, roundId);
      // Gear sales between the two claims must not change what the second is paid.
      await fundJackpot(1_000);
      await claim(small.kp, small.skrAta, small.oreAta, roundId);

      const bigGot = (await balance(big.skrAta)) - bigBefore;
      const smallGot = (await balance(small.skrAta)) - smallBefore;
      expect(bigGot).to.equal((poolBefore * 7_500n) / 10_000n);
      expect(smallGot).to.equal((poolBefore * 2_500n) / 10_000n);
      expect(bigGot).to.equal(smallGot * 3n);
      // One hit, both assets, the same share of the square.
      const bigOreGot = (await balance(big.oreAta)) - bigOreBefore;
      expect(bigOreGot).to.equal((orePoolBefore * 7_500n) / 10_000n);
    });

    it('pays nothing on a round where ORE did not hit its motherlode', async () => {
      const p = await fundedPlayer();
      const roundId = 2_010;
      const deployed = zeros25();
      deployed[11] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 11, endSlot: 10 });
      const mine = zeros25();
      mine[11] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      try {
        await claim(p.kp, p.skrAta, p.oreAta, roundId);
        expect.fail('there is no Gali jackpot without an ORE motherlode');
      } catch (e) {
        expect(String(e)).to.match(/NothingToClaim/);
      }
    });

    it('pays nothing to someone who was not on the winning square', async () => {
      const p = await fundedPlayer();
      const roundId = 2_020;
      const deployed = zeros25();
      deployed[12] = LAMPORTS_PER_SOL;
      deployed[13] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({
        id: roundId,
        deployed,
        winningSquare: 12,
        motherlode: whole(1, ORE_DECIMALS),
        endSlot: 10,
      });
      const mine = zeros25();
      mine[13] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      try {
        await claim(p.kp, p.skrAta, p.oreAta, roundId);
        expect.fail('the jackpot follows the winning square');
      } catch (e) {
        expect(String(e)).to.match(/NotOnWinningSquare/);
      }
    });

    it('pays a round only once per player', async () => {
      const p = await fundedPlayer();
      const roundId = 2_030;
      const deployed = zeros25();
      deployed[14] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({
        id: roundId,
        deployed,
        winningSquare: 14,
        motherlode: whole(1, ORE_DECIMALS),
        endSlot: 10,
      });
      const mine = zeros25();
      mine[14] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await claim(p.kp, p.skrAta, p.oreAta, roundId);
      try {
        await claim(p.kp, p.skrAta, p.oreAta, roundId);
        expect.fail('the jackpot should pay a player once per round');
      } catch (e) {
        expect(String(e)).to.match(/OreRoundAlreadyRecorded/);
      }
    });
  });

  describe('staking boosts, but only from before the round', () => {
    const stake = (owner: Keypair, ata: PublicKey, raw: bigint) =>
      program.methods
        .stakeSkr(new BN(raw.toString()))
        .accountsStrict({
          owner: owner.publicKey,
          config,
          player: playerPda(owner.publicKey),
          skrMint,
          userAta: ata,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([owner])
        .rpc();

    it('applies the boost when the stake predates the round', async () => {
      const p = await fundedPlayer();
      await stake(p.kp, p.skrAta, whole(5_000, SKR_DECIMALS));

      const slot = await conn.getSlot();
      const roundId = 3_000;
      const deployed = zeros25();
      deployed[6] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      // A round that closed well after the stake went in.
      await setRound({ id: roundId, deployed, winningSquare: 6, endSlot: slot + 100_000 });
      const mine = zeros25();
      mine[6] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await recordRound(p.kp.publicKey, roundId);
      // 250 at the 1.25x tier.
      expect((await acc.player.fetch(playerPda(p.kp.publicKey))).points.toNumber()).to.equal(312);
    });

    it('ignores a stake that only arrived after the round ended', async () => {
      const p = await fundedPlayer();
      await stake(p.kp, p.skrAta, whole(50_000, SKR_DECIMALS));

      const roundId = 3_010;
      const deployed = zeros25();
      deployed[6] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      // This round closed at slot 10, long before the stake existed.
      await setRound({ id: roundId, deployed, winningSquare: 6, endSlot: 10 });
      const mine = zeros25();
      mine[6] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      await recordRound(p.kp.publicKey, roundId);
      // Unboosted: the same tokens cannot be walked from wallet to wallet.
      expect((await acc.player.fetch(playerPda(p.kp.publicKey))).points.toNumber()).to.equal(250);
    });
  });

  describe('accounts that are not ORE\'s', () => {
    it('rejects a round account owned by something else', async () => {
      const p = await fundedPlayer();
      const roundId = 4_000;
      await setBoard(roundId + 1);
      const mine = zeros25();
      mine[0] = LAMPORTS_PER_SOL;
      await setMiner({ authority: p.kp.publicKey, roundId, deployed: mine });

      try {
        await program.methods
          .recordOreRound(new BN(roundId))
          .accountsStrict({
            cranker: admin.publicKey,
            config,
            player: playerPda(p.kp.publicKey),
            oreBoard: oreBoardPda(),
            // A real account, but Gali's own rather than ORE's.
            oreRound: config,
            oreMiner: oreMinerPda(p.kp.publicKey),
          })
          .rpc();
        expect.fail('a non-ORE account should never be decoded');
      } catch (e) {
        expect(String(e)).to.match(/BadOreAccount/);
      }
    });

    it('rejects being credited from another wallet\'s miner account', async () => {
      const a = await fundedPlayer();
      const b = await fundedPlayer();
      const roundId = 4_010;
      const deployed = zeros25();
      deployed[0] = LAMPORTS_PER_SOL;
      await setBoard(roundId + 1);
      await setRound({ id: roundId, deployed, winningSquare: 0, endSlot: 10 });
      const mine = zeros25();
      mine[0] = LAMPORTS_PER_SOL;
      await setMiner({ authority: b.kp.publicKey, roundId, deployed: mine });

      try {
        await program.methods
          .recordOreRound(new BN(roundId))
          .accountsStrict({
            cranker: admin.publicKey,
            config,
            player: playerPda(a.kp.publicKey),
            oreBoard: oreBoardPda(),
            oreRound: oreRoundPda(roundId),
            oreMiner: oreMinerPda(b.kp.publicKey), // someone else's position
          })
          .rpc();
        expect.fail('one player should not be creditable from another\'s position');
      } catch (e) {
        expect(String(e)).to.match(/BadOreAccount|ConstraintSeeds/);
      }
    });
  });
});
