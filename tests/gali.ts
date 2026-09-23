import * as anchor from '@coral-xyz/anchor';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { expect } from 'chai';
import { createHash } from 'crypto';
import idl from '../target/idl/gali.json';

const u64le = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
/** Mirror of the program's solo_mask: Fisher-Yates pick of 10 of 25 spots from sha256("gali-solo" || round). */
const soloMask = (round: number) => {
  const seed = createHash('sha256').update(Buffer.concat([Buffer.from('gali-solo'), u64le(round)])).digest();
  const idx = Array.from({ length: 25 }, (_, i) => i);
  let mask = 0;
  for (let i = 0; i < 10; i++) {
    const j = i + (seed.readUInt16LE(2 * i) % (25 - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
    mask |= 1 << idx[i];
  }
  return mask >>> 0;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Set when the program was built with the `fasttime` feature (CLOSE_AFTER_SECS and ABANDON_SECS are 0),
 *  which is the only way to exercise close_round and refund_stake without waiting a day. */
const FAST = process.env.GALI_FASTTIME === '1';

describe('gali', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl as anchor.Idl, provider);
  const pid = program.programId;
  const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];
  const config = find(Buffer.from('config'));
  const vault = find(Buffer.from('vault'));
  const treasury = find(Buffer.from('treasury'));
  const motherlode = find(Buffer.from('motherlode'));
  const rewards = find(Buffer.from('rewards'));
  const potVault = find(Buffer.from('pot_vault'));
  const buyback = find(Buffer.from('buyback'));
  const skrOf = async (k: PublicKey) => Number((await getAccount(provider.connection, k)).amount);
  const acc = program.account as any;

  // round ids come from the validator's clock, which can drift from this machine's clock
  const chainSecs = async () => {
    const slot = await provider.connection.getSlot();
    return (await provider.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  };
  /** Waits until the current round has at least `need` seconds left, then returns its id. */
  const freshRound = async (need: number) => {
    let now = await chainSecs();
    if (ROUND - (now % ROUND) < need) {
      await sleep((ROUND - (now % ROUND) + 1) * 1000);
      now = await chainSecs();
    }
    return Math.floor(now / ROUND);
  };
  /** Waits until round `r` has ended on-chain. */
  const afterRound = async (r: number) => {
    while ((await chainSecs()) < (r + 1) * ROUND) await sleep(1000);
  };

  const draw = (r: number) => find(Buffer.from('draw'), u64le(r));
  const roundOf = (r: number) => find(Buffer.from('round'), u64le(r));
  const lockRound = (r: number) =>
    program.methods
      .lockRound(new anchor.BN(r))
      .accountsStrict({ payer: provider.wallet.publicKey, config, draw: draw(r), round: roundOf(r), systemProgram: SystemProgram.programId })
      .rpc();
  const revealRound = (r: number) =>
    program.methods
      .revealRound(new anchor.BN(r))
      .accountsStrict({ payer: provider.wallet.publicKey, config, round: roundOf(r), draw: draw(r), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
      .rpc();
  const errOf = async (p: Promise<unknown>) => {
    try {
      await p;
      return '';
    } catch (e) {
      return String(e);
    }
  };

  const player = Keypair.generate();
  const playerPda = find(Buffer.from('player'), player.publicKey.toBuffer());
  let mint: PublicKey;
  let userAta: PublicKey;
  const ROUND = 15;

  before(async () => {
    const conn = provider.connection;
    await conn.confirmTransaction(await conn.requestAirdrop(player.publicKey, 2 * LAMPORTS_PER_SOL));
    const payer = (provider.wallet as anchor.Wallet).payer;
    mint = await createMint(conn, payer, payer.publicKey, null, 6);
    userAta = (await getOrCreateAssociatedTokenAccount(conn, payer, mint, player.publicKey)).address;
    await mintTo(conn, payer, mint, userAta, payer, 20_000_000_000n);
  });

  const programData = PublicKey.findProgramAddressSync([pid.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];

  it('only lets the upgrade authority initialise config', async () => {
    const rando = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(rando.publicKey, LAMPORTS_PER_SOL));
    const err = await errOf(
      program.methods
        .initConfig({
          roundSecs: ROUND,
          basePoints: new anchor.BN(40),
          motherlodePoints: new anchor.BN(10_000),
          boostTier1: new anchor.BN(1),
          boostTier2: new anchor.BN(2),
          gearPrices: [],
          motherlodeSkr: new anchor.BN(1),
          motherlodePoolBps: 0,
          rewardsPoolBps: 0,
          potFeeBps: 0,
          minDeploy: new anchor.BN(1),
          roundRewardSkr: new anchor.BN(0),
          rewardDripBps: 100,
          buybackBps: 0,
        })
        .accountsStrict({
          authority: rando.publicKey,
          program: pid,
          programData,
          config,
          skrMint: mint,
          vault,
          treasury,
          motherlode,
          rewards,
          potVault,
          buyback,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc(),
    );
    expect(err).to.contain('NotUpgradeAuthority');
  });

  it('initialises config', async () => {
    await program.methods
      .initConfig({
        roundSecs: ROUND,
        basePoints: new anchor.BN(40),
        motherlodePoints: new anchor.BN(10_000),
        boostTier1: new anchor.BN(1_000_000_000),
        boostTier2: new anchor.BN(10_000_000_000),
        gearPrices: [new anchor.BN(0), new anchor.BN(50_000_000)],
        motherlodeSkr: new anchor.BN(5_000_000),
        motherlodePoolBps: 3_000,
        rewardsPoolBps: 4_000,
        potFeeBps: 1_000,
        minDeploy: new anchor.BN(1_000_000),
        roundRewardSkr: new anchor.BN(25_000_000),
        rewardDripBps: 100, // 1% of the pool a round; the pool is big enough that the caps bind
        buybackBps: 5_000,
      })
      .accountsStrict({
        authority: provider.wallet.publicKey,
        program: pid,
        programData,
        config,
        skrMint: mint,
        vault,
        treasury,
        motherlode,
        rewards,
        potVault,
        buyback,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    // seed the Rewards Pool so rounds pay out SKR
    const payer = (provider.wallet as anchor.Wallet).payer;
    const funderAta = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
    await mintTo(provider.connection, payer, mint, funderAta, payer, 4_000_000_000n);
    await program.methods
      .fundRewards(new anchor.BN(4_000_000_000))
      .accountsStrict({ funder: payer.publicKey, config, skrMint: mint, funderAta, rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    expect(await skrOf(rewards)).to.eq(4_000_000_000);
    const c = await acc.config.fetch(config);
    expect(c.roundSecs).to.eq(ROUND);
  });

  it('creates a player', async () => {
    await program.methods.initPlayer().accountsStrict({ owner: player.publicKey, player: playerPda, systemProgram: SystemProgram.programId }).signers([player]).rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.gearMask).to.eq(1);
  });

  it('stakes SKR for a boost', async () => {
    await program.methods
      .stakeSkr(new anchor.BN(1_000_000_000))
      .accountsStrict({ owner: player.publicKey, config, player: playerPda, skrMint: mint, userAta, vault, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([player])
      .rpc();
    const v = await getAccount(provider.connection, vault);
    expect(Number(v.amount)).to.eq(1_000_000_000);
  });

  let rival: Keypair;
  let rivalPda: PublicKey;
  it('mines with SOL: fees per spot, winners split the pot, SKR to the winning spot, claimed later', async () => {
    const conn = provider.connection;
    rival = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(rival.publicKey, LAMPORTS_PER_SOL));
    rivalPda = find(Buffer.from('player'), rival.publicKey.toBuffer());
    await program.methods.initPlayer().accountsStrict({ owner: rival.publicKey, player: rivalPda, systemProgram: SystemProgram.programId }).signers([rival]).rpc();

    const round = await freshRound(8);
    const pot = find(Buffer.from('pot'), u64le(round));
    const stakeOf = (o: PublicKey) => find(Buffer.from('stake'), o.toBuffer(), u64le(round));
    const deploy = (kp: Keypair, pda: PublicKey, mask: number, lamports: number) =>
      program.methods
        .deploy(new anchor.BN(round), mask, new anchor.BN(lamports))
        .accountsStrict({ signer: kp.publicKey, owner: kp.publicKey, config, player: pda, pot, stake: stakeOf(kp.publicKey), systemProgram: SystemProgram.programId })
        .signers([kp])
        .rpc();

    let failed = false;
    try {
      await deploy(rival, rivalPda, 1, 10); // below min_deploy
    } catch {
      failed = true;
    }
    expect(failed).to.eq(true);

    // both cover every block, so every run has two winners: 1/3 player, 2/3 rival
    await deploy(player, playerPda, (1 << 25) - 1, 10_000_000); // 0.01 SOL on every block
    await deploy(rival, rivalPda, (1 << 25) - 1, 20_000_000); // 0.02 on every block, after the player
    // one deposit per block per round keeps each stake's range contiguous for the lucky draw
    let again = '';
    try {
      await deploy(rival, rivalPda, 1, 10_000_000);
    } catch (e) {
      again = String(e);
    }
    expect(again).to.contain('AlreadyOnBlock');
    const before = await acc.pot.fetch(pot);
    expect(before.total.toNumber()).to.eq(750_000_000);
    expect(before.perBlock[0].toNumber()).to.eq(30_000_000);
    expect(before.miners).to.eq(2);
    const rivalStake = await acc.stake.fetch(stakeOf(rival.publicKey));
    expect(rivalStake.start[0].toNumber()).to.eq(10_000_000); // after the player's 0.01

    // the draw can't be locked or revealed early, or revealed without a lock
    expect(await errOf(lockRound(round))).to.contain('RoundNotOver');
    await afterRound(round);
    expect(await errOf(revealRound(round))).to.contain('AccountNotInitialized');
    const roundPda = roundOf(round);
    await lockRound(round);
    expect(await errOf(lockRound(round))).to.contain('AlreadyLocked'); // no re-roll by re-locking
    for (let i = 0; !(await provider.connection.getAccountInfo(roundPda)); i++) {
      const e = await errOf(revealRound(round));
      if (e && (i > 20 || !e.includes('NoEntropy'))) throw new Error(e); // NoEntropy: locked slot not reached yet
      if (e) await sleep(300);
    }
    expect(await errOf(revealRound(round))).to.match(/already in use|AccountNotInitialized/); // one reveal only
    expect(await provider.connection.getAccountInfo(draw(round))).to.eq(null); // closed by the reveal
    expect(await errOf(lockRound(round))).to.contain('AlreadyRevealed');
    const r = await acc.round.fetch(roundPda);
    // solo spots are fixed by the round id; the client mirror must agree with the program
    expect(r.splitReward).to.eq((soloMask(round) & (1 << r.winningBlock)) === 0);
    expect(soloMask(round).toString(2).split('1').length - 1).to.eq(10);
    const rewardsBefore = await skrOf(rewards);
    const mlBefore = await skrOf(motherlode);
    const feeBefore = await conn.getBalance(provider.wallet.publicKey);
    await program.methods
      .settlePot(new anchor.BN(round))
      .accountsStrict({ config, round: roundPda, pot, feeTo: provider.wallet.publicKey, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    const settled = await acc.pot.fetch(pot);
    expect(settled.settled).to.eq(true);
    // 30M per spot: 1% admin (300k) on all 25, 10% of the rest (2.97M) on the 24 losing spots
    expect(settled.adminFee.toNumber()).to.eq(7_500_000);
    expect(settled.protocolFee.toNumber()).to.eq(71_280_000);
    expect(settled.pool.toNumber()).to.eq(750_000_000 - 78_780_000);
    expect(settled.feeBps).to.eq(1_000);
    void feeBefore;
    expect(settled.skrReward.toNumber()).to.eq(25_000_000);
    // round reward to escrow, then 5 SKR top-up of the Motherlode Pool (after any payout)
    expect(rewardsBefore - (await skrOf(rewards))).to.eq(30_000_000);
    if (r.motherlode) {
      expect(settled.motherlodeSkr.toNumber()).to.eq(mlBefore);
      expect(await skrOf(motherlode)).to.eq(5_000_000);
    } else {
      expect(settled.motherlodeSkr.toNumber()).to.eq(0);
      expect((await skrOf(motherlode)) - mlBefore).to.eq(5_000_000);
    }

    const unclaimedOf = (o: PublicKey) => find(Buffer.from('unclaimed'), o.toBuffer());
    const refinery = find(Buffer.from('refinery'));
    // half of the 78.78M lamports of fees is owed to SKR buybacks
    expect((await acc.config.fetch(config)).buybackDue.toNumber()).to.eq(39_390_000);
    const got: { sol: number; skr: number; rent: number }[] = [];
    for (const [kp, pda] of [
      [player, playerPda],
      [rival, rivalPda],
    ] as const) {
      const sol0 = await conn.getBalance(kp.publicKey);
      const rent = (await conn.getBalance(stakeOf(kp.publicKey))) - 20_000; // minus the crank fee, refunded to the payer on close
      await program.methods
        .claimPot(new anchor.BN(round))
        .accountsStrict({
          cranker: provider.wallet.publicKey,
          owner: kp.publicKey,
          payer: kp.publicKey,
          config,
          player: pda,
          round: roundPda,
          pot,
          stake: stakeOf(kp.publicKey),
          unclaimed: unclaimedOf(kp.publicKey),
          refinery,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      // nothing reaches the wallet yet except the stake rent
      expect((await conn.getBalance(kp.publicKey)) - sol0).to.eq(rent);
      const u = await acc.unclaimed.fetch(unclaimedOf(kp.publicKey));
      got.push({ sol: u.sol.toNumber(), skr: u.skr.toNumber(), rent });
      expect(await conn.getAccountInfo(stakeOf(kp.publicKey))).to.eq(null);
    }
    const reward = settled.skrReward.toNumber();
    const mlPaid = settled.motherlodeSkr.toNumber();
    expect(settled.splitReward).to.eq(r.splitReward);
    expect((await acc.pot.fetch(pot)).winnersPaid).to.eq(2);
    console.log(`      round mode: ${r.splitReward ? 'split' : 'solo spot'} (spot ${r.winningBlock}, lucky index ${settled.luckyIndex.toNumber()})`);
    // both covered every spot, so both win: player 1/3 and rival 2/3 of the pool (their SOL minus fees, no profit)
    expect(got[0].sol).to.eq(223_740_000);
    expect(got[1].sol).to.eq(447_480_000);
    const mlShare = [Math.floor(mlPaid / 3), Math.floor((mlPaid * 2) / 3)];
    if (r.splitReward) {
      expect(got[0].skr).to.eq(Math.floor(reward / 3) + mlShare[0]);
      expect(got[1].skr).to.eq(Math.floor((reward * 2) / 3) + mlShare[1]);
      expect(settled.winner.equals(PublicKey.default)).to.eq(true);
    } else {
      // on the winning spot, lamports 0..10M belong to the player and 10M..30M to the rival
      const playerWins = settled.luckyIndex.toNumber() < 10_000_000;
      expect(got[0].skr).to.eq((playerWins ? reward : 0) + mlShare[0]);
      expect(got[1].skr).to.eq((playerWins ? 0 : reward) + mlShare[1]);
      expect((await acc.pot.fetch(pot)).winner.equals(playerWins ? player.publicKey : rival.publicKey)).to.eq(true);
    }

    // claim_rewards: only the owner (or their session) can pay out, and only once
    const claimRewards = (signer: Keypair, owner: PublicKey, pda: PublicKey, what = 3) =>
      program.methods
        .claimRewards(what)
        .accountsStrict({
          owner,
          config,
          player: pda,
          unclaimed: unclaimedOf(owner),
          refinery,
          skrMint: mint,
          potVault,
          rewards,
          ownerAta: PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0],
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([signer])
        .rpc();
    // only the owner can claim: a session key (or anyone else) can't move rewards out
    expect(await errOf(claimRewards(rival, player.publicKey, playerPda))).to.contain('unknown signer');
    // SOL and SKR can be claimed separately
    const sol0 = await conn.getBalance(player.publicKey);
    const skr0 = await skrOf(userAta);
    await claimRewards(player, player.publicKey, playerPda, 1);
    expect((await conn.getBalance(player.publicKey)) - sol0).to.eq(got[0].sol); // the provider pays the tx fee
    expect(await skrOf(userAta)).to.eq(skr0);
    const u0 = await acc.unclaimed.fetch(unclaimedOf(player.publicKey));
    expect(u0.sol.toNumber()).to.eq(0);
    expect(u0.skr.toNumber()).to.eq(got[0].skr);
    expect(u0.claimedSol.toNumber()).to.eq(got[0].sol);
    // claiming unrefined SKR costs 10%, shared with the rival who still holds theirs
    const feeTaken = Math.floor(got[0].skr / 10);
    if (got[0].skr > 0) {
      await claimRewards(player, player.publicKey, playerPda, 2);
      expect((await skrOf(userAta)) - skr0).to.eq(got[0].skr - feeTaken);
    }
    console.log(`      refining: player unrefined ${got[0].skr}, fee ${feeTaken}, rival unrefined ${got[1].skr}`);
    expect(await errOf(claimRewards(player, player.publicKey, playerPda))).to.contain('NothingToClaim');
    const perSkr = feeTaken && got[1].skr ? (BigInt(feeTaken) * 1_000_000_000_000n) / BigInt(got[1].skr) : 0n;
    const gain = Number((perSkr * BigInt(got[1].skr)) / 1_000_000_000_000n);
    const rf = await acc.refinery.fetch(refinery);
    expect(rf.totalUnrefined.toNumber()).to.eq(got[1].skr);
    expect(rf.totalRefined.toNumber()).to.eq(feeTaken);
    // the rival pays the fee too; as the last holder there is nobody to share it with, so it goes back to the pool
    const poolBefore = await skrOf(rewards);
    await claimRewards(rival, rival.publicKey, rivalPda);
    const rivalAta = PublicKey.findProgramAddressSync([rival.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
    const rivalFee = Math.floor(got[1].skr / 10);
    expect(await skrOf(rivalAta)).to.eq(got[1].skr - rivalFee + gain);
    expect((await skrOf(rewards)) - poolBefore).to.eq(rivalFee);
    expect(gain).to.be.closeTo(feeTaken, 1);
    const rf2 = await acc.refinery.fetch(refinery);
    expect(rf2.totalUnrefined.toNumber()).to.eq(0);

    // points: 40 x 25 / blocks covered, x1.25 for the player's staked SKR (+10,000 base on a motherlode)
    const p = await acc.player.fetch(playerPda);
    const q = await acc.player.fetch(rivalPda);
    const ml = r.motherlode ? 10_000 : 0;
    expect(p.solDeployed.toNumber()).to.eq(250_000_000);
    expect(p.rounds).to.eq(1);
    expect(q.rounds).to.eq(1);
    expect(p.wins).to.eq(1);
    expect(q.wins).to.eq(1);
    expect(p.points.toNumber()).to.eq(Math.floor(((40 + ml) * 12_500) / 10_000)); // staked: 1.25x
    expect(q.points.toNumber()).to.eq(40 + ml);
  });

  it('nobody on the gold spot: the whole pot is fee, and settling twice is refused', async () => {
    const conn = provider.connection;
    const solo = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(solo.publicKey, LAMPORTS_PER_SOL));
    const soloPda = find(Buffer.from('player'), solo.publicKey.toBuffer());
    await program.methods.initPlayer().accountsStrict({ owner: solo.publicKey, player: soloPda, systemProgram: SystemProgram.programId }).signers([solo]).rpc();
    const round = await freshRound(8);
    const pot = find(Buffer.from('pot'), u64le(round));
    const stake = find(Buffer.from('stake'), solo.publicKey.toBuffer(), u64le(round));
    await program.methods
      .deploy(new anchor.BN(round), 0b11, new anchor.BN(2_000_000)) // spots 0 and 1 only
      .accountsStrict({ signer: solo.publicKey, owner: solo.publicKey, config, player: soloPda, pot, stake, systemProgram: SystemProgram.programId })
      .signers([solo])
      .rpc();
    // the round locks in the last 3 seconds (use the chain's clock, not this machine's)
    while ((round + 1) * ROUND - (await chainSecs()) > 2) await sleep(250);
    expect(await errOf(
      program.methods
        .deploy(new anchor.BN(round), 0b100, new anchor.BN(2_000_000))
        .accountsStrict({ signer: solo.publicKey, owner: solo.publicKey, config, player: soloPda, pot, stake, systemProgram: SystemProgram.programId })
        .signers([solo])
        .rpc(),
    )).to.match(/RoundLocked|WrongRound/);
    await afterRound(round);
    await lockRound(round);
    for (let i = 0; !(await conn.getAccountInfo(roundOf(round))); i++) {
      const e = await errOf(revealRound(round));
      if (e && (i > 40 || !e.includes('NoEntropy'))) throw new Error(e);
      if (e) await sleep(300);
    }
    const r = await acc.round.fetch(roundOf(round));
    const settle = () =>
      program.methods
        .settlePot(new anchor.BN(round))
        .accountsStrict({ config, round: roundOf(round), pot, feeTo: provider.wallet.publicKey, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
    const rewardsBefore = await skrOf(rewards);
    await settle();
    expect(await errOf(settle())).to.contain('AlreadySettled');
    const p = await acc.pot.fetch(pot);
    const unclaimed = find(Buffer.from('unclaimed'), solo.publicKey.toBuffer());
    const claim = () =>
      program.methods
        .claimPot(new anchor.BN(round))
        .accountsStrict({ cranker: provider.wallet.publicKey, owner: solo.publicKey, payer: solo.publicKey, config, player: soloPda, round: roundOf(round), pot, stake, unclaimed, refinery: find(Buffer.from('refinery')), systemProgram: SystemProgram.programId })
        .rpc();
    const before = (await acc.unclaimed.fetchNullable(unclaimed))?.sol.toNumber() ?? 0;
    await claim();
    expect(await errOf(claim())).to.match(/AccountNotInitialized|has already been processed/);
    const credited = (await acc.unclaimed.fetch(unclaimed)).sol.toNumber() - before;
    if (r.winningBlock > 1) {
      // nobody was on the gold spot: everything after the 1% admin fee is protocol fee, nothing is paid out
      expect(p.pool.toNumber()).to.eq(0);
      expect(p.adminFee.toNumber() + p.protocolFee.toNumber()).to.eq(4_000_000);
      expect(p.skrReward.toNumber()).to.eq(0);
      expect(credited).to.eq(0);
      // no round reward is paid, only the Motherlode top-up still runs
      expect(rewardsBefore - (await skrOf(rewards))).to.eq(5_000_000);
    } else {
      expect(credited).to.be.greaterThan(0);
    }
    // an abandoned-round refund is refused while the round is fresh (and it was revealed anyway)
    expect(await errOf(
      program.methods
        .refundStake(new anchor.BN(round))
        .accountsStrict({ cranker: provider.wallet.publicKey, owner: solo.publicKey, payer: solo.publicKey, config, pot, round: roundOf(round), stake })
        .rpc(),
    )).to.match(/TooEarly|AccountNotInitialized/);
  });

  it('losers get no SOL: the winning spot takes the losing spots\' SOL', async () => {
    const conn = provider.connection;
    const loner = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(loner.publicKey, LAMPORTS_PER_SOL));
    const lonerPda = find(Buffer.from('player'), loner.publicKey.toBuffer());
    await program.methods.initPlayer().accountsStrict({ owner: loner.publicKey, player: lonerPda, systemProgram: SystemProgram.programId }).signers([loner]).rpc();
    const round = await freshRound(8);
    const pot = find(Buffer.from('pot'), u64le(round));
    const stakeOf = (o: PublicKey) => find(Buffer.from('stake'), o.toBuffer(), u64le(round));
    const dep = (kp: Keypair, pda: PublicKey, mask: number, lamports: number) =>
      program.methods
        .deploy(new anchor.BN(round), mask, new anchor.BN(lamports))
        .accountsStrict({ signer: kp.publicKey, owner: kp.publicKey, config, player: pda, pot, stake: stakeOf(kp.publicKey), systemProgram: SystemProgram.programId })
        .signers([kp])
        .rpc();
    await dep(rival, rivalPda, (1 << 25) - 1, 1_000_000); // 1M on every spot
    await dep(loner, lonerPda, 0b1, 4_000_000); // 4M on spot 0 only
    await afterRound(round);
    await lockRound(round);
    for (let i = 0; !(await conn.getAccountInfo(roundOf(round))); i++) {
      const e = await errOf(revealRound(round));
      if (e && (i > 20 || !e.includes('NoEntropy'))) throw new Error(e);
      if (e) await sleep(300);
    }
    const r = await acc.round.fetch(roundOf(round));
    await program.methods
      .settlePot(new anchor.BN(round))
      .accountsStrict({ config, round: roundOf(round), pot, feeTo: provider.wallet.publicKey, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    const w = r.winningBlock;
    const d = Array.from({ length: 25 }, (_, i) => 1_000_000 + (i === 0 ? 4_000_000 : 0));
    const cfgNow = await acc.config.fetch(config);
    let fees = 0;
    d.forEach((v, i) => {
      const admin = Math.floor(v / 100);
      fees += admin + (i === w ? 0 : Math.floor(((v - admin) * cfgNow.potFeeBps) / 10_000));
    });
    const pool = 29_000_000 - fees;
    const settled = await acc.pot.fetch(pot);
    expect(settled.pool.toNumber()).to.eq(pool);
    const refinery = find(Buffer.from('refinery'));
    const credited: number[] = [];
    for (const [kp, pda] of [
      [rival, rivalPda],
      [loner, lonerPda],
    ] as const) {
      const unclaimed = find(Buffer.from('unclaimed'), kp.publicKey.toBuffer());
      const before = (await acc.unclaimed.fetchNullable(unclaimed))?.sol.toNumber() ?? 0;
      await program.methods
        .claimPot(new anchor.BN(round))
        .accountsStrict({ cranker: provider.wallet.publicKey, owner: kp.publicKey, payer: kp.publicKey, config, player: pda, round: roundOf(round), pot, stake: stakeOf(kp.publicKey), unclaimed, refinery, systemProgram: SystemProgram.programId })
        .rpc();
      credited.push((await acc.unclaimed.fetch(unclaimed)).sol.toNumber() - before);
    }
    console.log(`      winning spot ${w}: rival +${credited[0]}, loner +${credited[1]} (pool ${pool})`);
    if (w === 0) {
      // spot 0 holds 5M: rival 1/5, loner 4/5 of the whole pool
      expect(credited[0]).to.eq(Math.floor((1_000_000 * pool) / 5_000_000));
      expect(credited[1]).to.eq(Math.floor((4_000_000 * pool) / 5_000_000));
    } else {
      // the loner missed: nothing back. The rival alone on the gold spot takes everything, incl. the loner's SOL
      expect(credited[1]).to.eq(0);
      expect(credited[0]).to.eq(pool);
      expect(credited[0]).to.be.greaterThan(25_000_000); // more than the rival put in
    }
    // every stake is claimed, but the round's accounts stay for a day (history), then anyone can close them
    const p2 = await acc.pot.fetch(pot);
    expect(p2.claimed).to.eq(2);
    expect(p2.rentPayer.equals(rival.publicKey)).to.eq(true); // first deployer paid the pot's rent
    expect((await acc.round.fetch(roundOf(round))).rentPayer.equals(provider.wallet.publicKey)).to.eq(true);
    const closeRound = () =>
      program.methods
        .closeRound(new anchor.BN(round))
        .accountsStrict({ config, pot, round: roundOf(round), potRentPayer: rival.publicKey, roundRentPayer: provider.wallet.publicKey, feeTo: provider.wallet.publicKey })
        .rpc();
    if (!FAST) {
      expect(await errOf(closeRound())).to.contain('TooEarly');
      return;
    }
    // fasttime build: the wait is 0, so close it here and check the rent comes back
    const potLamports = await conn.getBalance(pot);
    const potRent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(pot))!.data.length);
    const dust = potLamports - potRent;
    const rivalBefore = await conn.getBalance(rival.publicKey);
    const feeToBefore = await conn.getBalance(provider.wallet.publicKey);
    await closeRound();
    expect(await conn.getAccountInfo(pot)).to.eq(null);
    expect(await conn.getAccountInfo(roundOf(round))).to.eq(null);
    // the first deployer paid the pot's rent and gets all of it back
    expect((await conn.getBalance(rival.publicKey)) - rivalBefore).to.eq(potRent);
    // rounding dust plus the round account's rent go to the treasury wallet (which also paid the tx fee)
    expect((await conn.getBalance(provider.wallet.publicKey)) - feeToBefore).to.be.greaterThan(dust);
    console.log(`      close_round: pot rent ${potRent} back to the first deployer, dust ${dust} to the treasury`);
  });

  it('refunds each player their own SOL when a round is never revealed', async function () {
    if (!FAST) return this.skip(); // needs ABANDON_SECS = 0 (the fasttime build)
    const conn = provider.connection;
    const a = Keypair.generate();
    const b = Keypair.generate();
    for (const kp of [a, b]) {
      await conn.confirmTransaction(await conn.requestAirdrop(kp.publicKey, LAMPORTS_PER_SOL));
      await program.methods
        .initPlayer()
        .accountsStrict({ owner: kp.publicKey, player: find(Buffer.from('player'), kp.publicKey.toBuffer()), systemProgram: SystemProgram.programId })
        .signers([kp])
        .rpc();
    }
    const round = await freshRound(8);
    const pot = find(Buffer.from('pot'), u64le(round));
    const stakeOf = (o: PublicKey) => find(Buffer.from('stake'), o.toBuffer(), u64le(round));
    const spend = { [a.publicKey.toBase58()]: 0, [b.publicKey.toBase58()]: 0 };
    for (const [kp, mask, per] of [
      [a, 0b111, 2_000_000],
      [b, 0b11000, 3_000_000],
    ] as const) {
      await program.methods
        .deploy(new anchor.BN(round), mask, new anchor.BN(per))
        .accountsStrict({
          signer: kp.publicKey,
          owner: kp.publicKey,
          config,
          player: find(Buffer.from('player'), kp.publicKey.toBuffer()),
          pot,
          stake: stakeOf(kp.publicKey),
          systemProgram: SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
      // 3 spots for a, 2 for b
      spend[kp.publicKey.toBase58()] = per * (mask === 0b111 ? 3 : 2);
    }
    // nobody locks or reveals: the round is abandoned
    await afterRound(round);
    const refund = (kp: Keypair) =>
      program.methods
        .refundStake(new anchor.BN(round))
        .accountsStrict({ cranker: provider.wallet.publicKey, owner: kp.publicKey, payer: kp.publicKey, config, pot, round: roundOf(round), stake: stakeOf(kp.publicKey) })
        .rpc();
    for (const kp of [a, b]) {
      const before = await conn.getBalance(kp.publicKey);
      const rent = await conn.getMinimumBalanceForRentExemption((await conn.getAccountInfo(stakeOf(kp.publicKey)))!.data.length);
      await refund(kp);
      // own SOL back, plus the stake's rent and the 20,000 crank fee it was carrying
      // (the cranker, not the player, pays the tx fee)
      expect((await conn.getBalance(kp.publicKey)) - before).to.eq(spend[kp.publicKey.toBase58()] + rent + 20_000);
    }
    const p = await acc.pot.fetch(pot);
    expect(p.refunded).to.eq(2);
    expect(p.total.toNumber()).to.eq(0);
    p.perBlock.forEach((v: anchor.BN) => expect(v.toNumber()).to.eq(0));
    // a refunded round can never be settled
    await lockRound(round);
    for (let i = 0; !(await conn.getAccountInfo(roundOf(round))); i++) {
      const e = await errOf(revealRound(round));
      if (e && (i > 40 || !e.includes('NoEntropy'))) throw new Error(e);
      if (e) await sleep(300);
    }
    expect(
      await errOf(
        program.methods
          .settlePot(new anchor.BN(round))
          .accountsStrict({ config, round: roundOf(round), pot, feeTo: provider.wallet.publicKey, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
          .rpc(),
      ),
    ).to.contain('RoundAbandoned');
  });

  const session = Keypair.generate();
  it('authorises a session key', async () => {
    const expires = Math.floor(Date.now() / 1000) + 3600;
    await program.methods
      .setSession(session.publicKey, new anchor.BN(expires), new anchor.BN(50_000_000))
      .accountsStrict({ owner: player.publicKey, player: playerPda, session: session.publicKey, systemProgram: SystemProgram.programId })
      .signers([player])
      .rpc();
    expect(await provider.connection.getBalance(session.publicKey)).to.eq(50_000_000);
  });

  const deployAs = async (signer: Keypair, lamports: number, mask = 0b11) => {
    const round = await freshRound(6);
    await program.methods
      .deploy(new anchor.BN(round), mask, new anchor.BN(lamports))
      .accountsStrict({
        signer: signer.publicKey,
        owner: player.publicKey,
        config,
        player: playerPda,
        pot: find(Buffer.from('pot'), u64le(round)),
        stake: find(Buffer.from('stake'), player.publicKey.toBuffer(), u64le(round)),
        systemProgram: SystemProgram.programId,
      })
      .signers([signer])
      .rpc();
    return round;
  };

  it('rejects a random signer', async () => {
    const rando = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(rando.publicKey, LAMPORTS_PER_SOL));
    let err = '';
    try {
      await deployAs(rando, 1_000_000);
    } catch (e) {
      err = String(e);
    }
    expect(err).to.contain('NotAuthorised');
  });

  it('lets the session key deploy its own SOL for the player', async () => {
    const before = await provider.connection.getBalance(session.publicKey);
    const round = await deployAs(session, 2_000_000);
    const st = await acc.stake.fetch(find(Buffer.from('stake'), player.publicKey.toBuffer(), u64le(round)));
    expect(st.owner.toBase58()).to.eq(player.publicKey.toBase58());
    expect(st.payer.toBase58()).to.eq(session.publicKey.toBase58());
    expect(st.perBlock[0].toNumber()).to.eq(2_000_000);
    expect(before - (await provider.connection.getBalance(session.publicKey))).to.be.gte(4_000_000);
    const p = await acc.player.fetch(playerPda);
    expect(p.rounds).to.eq(2);
  });

  it('stops honouring a session key once it has expired, and takes a fresh one', async () => {
    const setSession = (expires: number, fund: number) =>
      program.methods
        .setSession(session.publicKey, new anchor.BN(expires), new anchor.BN(fund))
        .accountsStrict({ owner: player.publicKey, player: playerPda, session: session.publicKey, systemProgram: SystemProgram.programId })
        .signers([player])
        .rpc();
    const now = await chainSecs();
    // expiry in the past: the key stays on the player account but can no longer deploy
    await setSession(now - 1, 0);
    expect((await acc.player.fetch(playerPda)).sessionExpires.toNumber()).to.eq(now - 1);
    expect(await errOf(deployAs(session, 1_000_000, 0b10000))).to.contain('NotAuthorised');
    // a session can't outlive the one-week cap
    expect(await errOf(setSession(now + 8 * 86_400, 0))).to.contain('BadSession');
    // the owner always can, and a fresh session works again
    await deployAs(player, 1_000_000, 0b10000);
    await setSession(now + 3_600, 0);
    await deployAs(session, 1_000_000, 0b100000);
  });

  it('buys gear with SKR', async () => {
    const rewardsBefore = await skrOf(rewards);
    const mlBefore = await skrOf(motherlode);
    await program.methods
      .buyGear(1)
      .accountsStrict({ owner: player.publicKey, config, player: playerPda, skrMint: mint, userAta, treasury, motherlode, rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([player])
      .rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.gearMask & 2).to.eq(2);
    // 30% Motherlode Pool, 40% Rewards Pool, 30% treasury
    expect(await skrOf(treasury)).to.eq(15_000_000);
    expect((await skrOf(motherlode)) - mlBefore).to.eq(15_000_000);
    expect((await skrOf(rewards)) - rewardsBefore).to.eq(20_000_000);
  });

  it('lets anyone fund the Motherlode Pool', async () => {
    const before = await skrOf(motherlode);
    const payer = (provider.wallet as anchor.Wallet).payer;
    const funderAta = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
    await mintTo(provider.connection, payer, mint, funderAta, payer, 1_000_000_000n);
    await program.methods
      .fundMotherlode(new anchor.BN(1_000_000_000))
      .accountsStrict({ funder: payer.publicKey, config, skrMint: mint, funderAta, motherlode, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    expect((await skrOf(motherlode)) - before).to.eq(1_000_000_000);
  });

  it('keeps staked SKR in place while it boosts the current round, then unstakes', async () => {
    const unstake = (r: number) =>
      program.methods
        .unstakeSkr(new anchor.BN(r), new anchor.BN(1_000_000_000))
        .accountsStrict({
          owner: player.publicKey,
          config,
          player: playerPda,
          currentStake: find(Buffer.from('stake'), player.publicKey.toBuffer(), u64le(r)),
          skrMint: mint,
          userAta,
          vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc();
    const round = await deployAs(player, 1_000_000, 0b1100);
    expect(await errOf(unstake(round))).to.contain('StakeInPlay');
    expect(await errOf(unstake(round - 1))).to.contain('WrongRound');
    await afterRound(round);
    const e = await errOf(unstake(Math.floor((await chainSecs()) / ROUND)));
    if (e) await unstake(Math.floor((await chainSecs()) / ROUND)); // crossed a round boundary; try again
    const p = await acc.player.fetch(playerPda);
    expect(p.stakedSkr.toNumber()).to.eq(0);
  });

  describe('admin', () => {
    const admin = provider.wallet.publicKey;
    const rando = Keypair.generate();
    const upd = (u: Record<string, unknown>) => ({
      basePoints: null,
      motherlodePoints: null,
      boostTier1: null,
      boostTier2: null,
      gearPrices: null,
      motherlodeSkr: null,
      motherlodePoolBps: null,
      rewardsPoolBps: null,
      potFeeBps: null,
      minDeploy: null,
      roundRewardSkr: null,
      rewardDripBps: null,
      buybackBps: null,
      ...u,
    });
    const fails = async (p: Promise<unknown>, msg: string) => {
      let err = '';
      try {
        await p;
      } catch (e) {
        err = String(e);
      }
      expect(err).to.contain(msg);
    };

    before(async () => {
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(rando.publicKey, LAMPORTS_PER_SOL));
    });

    it('updates settings within the caps', async () => {
      await program.methods
        .updateConfig(upd({ potFeeBps: 800, roundRewardSkr: new anchor.BN(30_000_000) }))
        .accountsStrict({ authority: admin, config })
        .rpc();
      const c = await acc.config.fetch(config);
      expect(c.potFeeBps).to.eq(800);
      expect(c.roundRewardSkr.toNumber()).to.eq(30_000_000);
      expect(c.minDeploy.toNumber()).to.eq(1_000_000); // untouched
      await fails(program.methods.updateConfig(upd({ potFeeBps: 5_000 })).accountsStrict({ authority: admin, config }).rpc(), 'BadConfig');
      await fails(program.methods.updateConfig(upd({ rewardDripBps: 101 })).accountsStrict({ authority: admin, config }).rpc(), 'BadConfig');
      await fails(program.methods.updateConfig(upd({ rewardDripBps: 0 })).accountsStrict({ authority: admin, config }).rpc(), 'BadConfig');
      await fails(program.methods.updateConfig(upd({ buybackBps: 10_001 })).accountsStrict({ authority: admin, config }).rpc(), 'BadConfig');
      // buybacks: the admin marks SOL spent on SKR for the Rewards Pool
      const due = (await acc.config.fetch(config)).buybackDue.toNumber();
      const escrow = await provider.connection.getBalance(buyback);
      expect(escrow).to.be.greaterThan(due - 1); // the escrow holds what is owed, plus its rent
      await program.methods.markBuyback(new anchor.BN(1_000)).accountsStrict({ authority: admin, config, buyback, destination: admin }).rpc();
      expect((await acc.config.fetch(config)).buybackDue.toNumber()).to.eq(due - 1_000);
      expect(await provider.connection.getBalance(buyback)).to.eq(escrow - 1_000);
      await fails(
        program.methods.markBuyback(new anchor.BN(1)).accountsStrict({ authority: rando.publicKey, config, buyback, destination: rando.publicKey }).signers([rando]).rpc(),
        'ConstraintHasOne',
      );
      await fails(program.methods.markBuyback(new anchor.BN(10_000_000_000)).accountsStrict({ authority: admin, config, buyback, destination: admin }).rpc(), 'BadAmount');
      await fails(
        program.methods.updateConfig(upd({ motherlodePoolBps: 6_000, rewardsPoolBps: 6_000 })).accountsStrict({ authority: admin, config }).rpc(),
        'BadConfig',
      );
    });

    it('refuses admin calls from anyone else', async () => {
      await fails(
        program.methods.updateConfig(upd({ potFeeBps: 0 })).accountsStrict({ authority: rando.publicKey, config }).signers([rando]).rpc(),
        'ConstraintHasOne',
      );
      await fails(program.methods.setPaused(true).accountsStrict({ authority: rando.publicKey, config }).signers([rando]).rpc(), 'ConstraintHasOne');
    });

    it('drip: a round pays at most a slice of the Rewards Pool', async () => {
      await program.methods.updateConfig(upd({ rewardDripBps: 1 })).accountsStrict({ authority: admin, config }).rpc();
      const c = await acc.config.fetch(config);
      const round = await deployAs(player, 1_000_000, (1 << 25) - 1);
      await afterRound(round);
      await lockRound(round);
      for (let i = 0; !(await provider.connection.getAccountInfo(roundOf(round))); i++) {
        const e = await errOf(revealRound(round));
        if (e && (i > 20 || !e.includes('NoEntropy'))) throw new Error(e);
        if (e) await sleep(300);
      }
      const pot = find(Buffer.from('pot'), u64le(round));
      const bal = await skrOf(rewards);
      const mlBefore = await skrOf(motherlode);
      await program.methods
        .settlePot(new anchor.BN(round))
        .accountsStrict({ config, round: roundOf(round), pot, feeTo: admin, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      const cap = c.roundRewardSkr.toNumber() + c.motherlodeSkr.toNumber();
      const budget = Math.min(cap, Math.floor(bal / 10_000));
      const reward = Math.floor((budget * c.roundRewardSkr.toNumber()) / cap);
      const settled = await acc.pot.fetch(pot);
      expect(budget).to.be.lessThan(cap);
      expect(settled.skrReward.toNumber()).to.eq(reward);
      expect(bal - (await skrOf(rewards))).to.eq(budget);
      if (!settled.motherlode) expect((await skrOf(motherlode)) - mlBefore).to.eq(budget - reward);
      await program.methods.updateConfig(upd({ rewardDripBps: 100 })).accountsStrict({ authority: admin, config }).rpc();
    });

    it('pause stops deploys and gear sales, then resumes', async () => {
      await program.methods.setPaused(true).accountsStrict({ authority: admin, config }).rpc();
      await fails(deployAs(player, 1_000_000, 0b1100), 'Paused');
      await program.methods.setPaused(false).accountsStrict({ authority: admin, config }).rpc();
      await deployAs(player, 1_000_000, 0b1100); // other blocks than the session's deploy
    });

    it('withdraws treasury SKR only for the authority', async () => {
      const payer = (provider.wallet as anchor.Wallet).payer;
      const dest = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
      const accounts = (authority: PublicKey) => ({ authority, config, skrMint: mint, treasury, destination: dest, tokenProgram: TOKEN_PROGRAM_ID });
      const t0 = await skrOf(treasury);
      expect(t0).to.be.gte(5_000_000);
      await fails(program.methods.withdrawTreasury(new anchor.BN(1)).accountsStrict(accounts(rando.publicKey)).signers([rando]).rpc(), 'ConstraintHasOne');
      await fails(program.methods.withdrawTreasury(new anchor.BN(t0 + 1)).accountsStrict(accounts(admin)).rpc(), 'BadAmount');
      const d0 = await skrOf(dest);
      await program.methods.withdrawTreasury(new anchor.BN(5_000_000)).accountsStrict(accounts(admin)).rpc();
      expect(await skrOf(treasury)).to.eq(t0 - 5_000_000);
      expect((await skrOf(dest)) - d0).to.eq(5_000_000);
    });

    it('refining: the fee is shared pro rata between every remaining holder', async function () {
      this.timeout(180_000);
      const conn = provider.connection;
      const refinery = find(Buffer.from('refinery'));
      const unclaimedOf = (o: PublicKey) => find(Buffer.from('unclaimed'), o.toBuffer());
      const ataOf = (o: PublicKey) =>
        PublicKey.findProgramAddressSync([o.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
      // three miners, all on all 25 spots, with different amounts per spot
      const crew = [1_000_000, 2_000_000, 5_000_000].map((per) => ({ kp: Keypair.generate(), per }));
      for (const m of crew) {
        await conn.confirmTransaction(await conn.requestAirdrop(m.kp.publicKey, 2 * LAMPORTS_PER_SOL));
        await program.methods
          .initPlayer()
          .accountsStrict({ owner: m.kp.publicKey, player: find(Buffer.from('player'), m.kp.publicKey.toBuffer()), systemProgram: SystemProgram.programId })
          .signers([m.kp])
          .rpc();
      }
      // the SKR reward only splits on a shared spot; on a solo spot one miner takes it all, so retry
      let skr: number[] = [];
      for (let attempt = 0; attempt < 4 && skr.length === 0; attempt++) {
        const round = await freshRound(10);
        const pot = find(Buffer.from('pot'), u64le(round));
        const stakeOf = (o: PublicKey) => find(Buffer.from('stake'), o.toBuffer(), u64le(round));
        for (const m of crew) {
          await program.methods
            .deploy(new anchor.BN(round), (1 << 25) - 1, new anchor.BN(m.per))
            .accountsStrict({
              signer: m.kp.publicKey,
              owner: m.kp.publicKey,
              config,
              player: find(Buffer.from('player'), m.kp.publicKey.toBuffer()),
              pot,
              stake: stakeOf(m.kp.publicKey),
              systemProgram: SystemProgram.programId,
            })
            .signers([m.kp])
            .rpc();
        }
        await afterRound(round);
        await lockRound(round);
        for (let i = 0; !(await conn.getAccountInfo(roundOf(round))); i++) {
          const e = await errOf(revealRound(round));
          if (e && (i > 40 || !e.includes('NoEntropy'))) throw new Error(e);
          if (e) await sleep(300);
        }
        await program.methods
          .settlePot(new anchor.BN(round))
          .accountsStrict({ config, round: roundOf(round), pot, feeTo: admin, buyback, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
          .rpc();
        const got: number[] = [];
        for (const m of crew) {
          const before = (await acc.unclaimed.fetchNullable(unclaimedOf(m.kp.publicKey)))?.skr.toNumber() ?? 0;
          await program.methods
            .claimPot(new anchor.BN(round))
            .accountsStrict({
              cranker: provider.wallet.publicKey,
              owner: m.kp.publicKey,
              payer: m.kp.publicKey,
              config,
              player: find(Buffer.from('player'), m.kp.publicKey.toBuffer()),
              round: roundOf(round),
              pot,
              stake: stakeOf(m.kp.publicKey),
              unclaimed: unclaimedOf(m.kp.publicKey),
              refinery,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          got.push((await acc.unclaimed.fetch(unclaimedOf(m.kp.publicKey))).skr.toNumber() - before);
        }
        if ((await acc.pot.fetch(pot)).splitReward && got.every((v) => v > 0)) skr = got;
      }
      expect(skr.length, 'no round landed on a shared spot in 4 tries').to.eq(3);
      // the reward splits by SOL on the winning spot: 1 : 2 : 5
      expect(skr[1]).to.be.closeTo(skr[0] * 2, 2);
      expect(skr[2]).to.be.closeTo(skr[0] * 5, 5);

      // earlier tests left their own unrefined SKR in the refinery, so measure against the real total
      const rf0 = await acc.refinery.fetch(refinery);
      const held0 = rf0.totalUnrefined.toNumber();
      expect(held0).to.be.gte(skr[0] + skr[1] + skr[2]);
      const claim = (kp: Keypair) =>
        program.methods
          .claimRewards(2)
          .accountsStrict({
            owner: kp.publicKey,
            config,
            player: find(Buffer.from('player'), kp.publicKey.toBuffer()),
            unclaimed: unclaimedOf(kp.publicKey),
            refinery,
            skrMint: mint,
            potVault,
            rewards,
            ownerAta: ataOf(kp.publicKey),
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([kp])
          .rpc();

      // the smallest holder cashes out; its 10% fee is split between the two who stay in, by size
      const fee0 = Math.floor(skr[0] / 10);
      await claim(crew[0].kp);
      expect(await skrOf(ataOf(crew[0].kp.publicKey))).to.eq(skr[0] - fee0);
      const SCALE = 1_000_000_000_000n;
      const held1 = held0 - skr[0];
      const delta = (BigInt(fee0) * SCALE) / BigInt(held1);
      const gain = [1, 2].map((i) => Number((delta * BigInt(skr[i])) / SCALE));
      expect(gain[0]).to.be.greaterThan(0);
      expect(gain[1]).to.be.closeTo(gain[0] * 2.5, 2); // 5 : 2, the ratio of what they still hold
      const rf1 = await acc.refinery.fetch(refinery);
      expect(rf1.totalUnrefined.toNumber()).to.eq(held1);
      expect(rf1.totalRefined.toNumber()).to.eq(rf0.totalRefined.toNumber() + fee0);
      console.log(`      refining: unrefined ${skr.join(' / ')} of ${held0} held, fee ${fee0} split ${gain.join(' / ')}`);

      // the middle holder cashes out next, and its own 10% is shared the same way
      const fee1 = Math.floor(skr[1] / 10);
      await claim(crew[1].kp);
      expect(await skrOf(ataOf(crew[1].kp.publicKey))).to.eq(skr[1] - fee1 + gain[0]);
      const held2 = held1 - skr[1];
      const delta2 = (BigInt(fee1) * SCALE) / BigInt(held2);
      const gain2 = gain[1] + Number((delta2 * BigInt(skr[2])) / SCALE);
      const fee2 = Math.floor(skr[2] / 10);
      await claim(crew[2].kp);
      expect(await skrOf(ataOf(crew[2].kp.publicKey))).to.eq(skr[2] - fee2 + gain2);
      const rf2 = await acc.refinery.fetch(refinery);
      expect(rf2.totalUnrefined.toNumber()).to.eq(held2 - skr[2]);
    });

    it('hands over authority in two steps, and back', async () => {
      await fails(program.methods.acceptAuthority().accountsStrict({ newAuthority: rando.publicKey, config }).signers([rando]).rpc(), 'NotAuthorised');
      await program.methods.proposeAuthority(rando.publicKey).accountsStrict({ authority: admin, config }).rpc();
      await program.methods.acceptAuthority().accountsStrict({ newAuthority: rando.publicKey, config }).signers([rando]).rpc();
      let c = await acc.config.fetch(config);
      expect(c.authority.toBase58()).to.eq(rando.publicKey.toBase58());
      expect(c.pendingAuthority.toBase58()).to.eq(PublicKey.default.toBase58());
      await fails(program.methods.setPaused(true).accountsStrict({ authority: admin, config }).rpc(), 'ConstraintHasOne');
      await program.methods.proposeAuthority(admin).accountsStrict({ authority: rando.publicKey, config }).signers([rando]).rpc();
      await program.methods.acceptAuthority().accountsStrict({ newAuthority: admin, config }).rpc();
      c = await acc.config.fetch(config);
      expect(c.authority.toBase58()).to.eq(admin.toBase58());
    });
  });
});
