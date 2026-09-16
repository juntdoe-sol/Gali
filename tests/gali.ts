import * as anchor from '@coral-xyz/anchor';
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY } from '@solana/web3.js';
import { expect } from 'chai';
import idl from '../target/idl/gali.json';

const u64le = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  const skrOf = async (k: PublicKey) => Number((await getAccount(provider.connection, k)).amount);
  const acc = program.account as any;

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

  it('initialises config', async () => {
    await program.methods
      .initConfig({
        roundSecs: ROUND,
        basePoints: new anchor.BN(40),
        motherlodePoints: new anchor.BN(10_000),
        boostTier1: new anchor.BN(1_000_000_000),
        boostTier2: new anchor.BN(10_000_000_000),
        gearPrices: [new anchor.BN(0), new anchor.BN(50_000_000)],
        motherlodeSkr: new anchor.BN(500_000_000),
        motherlodePoolBps: 3_000,
        rewardsPoolBps: 4_000,
        potFeeBps: 1_000,
        minDeploy: new anchor.BN(1_000_000),
        roundRewardSkr: new anchor.BN(25_000_000),
      })
      .accountsStrict({
        authority: provider.wallet.publicKey,
        config,
        skrMint: mint,
        vault,
        treasury,
        motherlode,
        rewards,
        potVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    // seed the Rewards Pool so rounds pay out SKR
    const payer = (provider.wallet as anchor.Wallet).payer;
    const funderAta = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
    await mintTo(provider.connection, payer, mint, funderAta, payer, 100_000_000n);
    await program.methods
      .fundRewards(new anchor.BN(100_000_000))
      .accountsStrict({ funder: payer.publicKey, config, skrMint: mint, funderAta, rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    expect(await skrOf(rewards)).to.eq(100_000_000);
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

  it('mines with SOL: winners split the SOL pot and the round SKR reward', async () => {
    const conn = provider.connection;
    const rival = Keypair.generate();
    await conn.confirmTransaction(await conn.requestAirdrop(rival.publicKey, LAMPORTS_PER_SOL));
    const rivalPda = find(Buffer.from('player'), rival.publicKey.toBuffer());
    await program.methods.initPlayer().accountsStrict({ owner: rival.publicKey, player: rivalPda, systemProgram: SystemProgram.programId }).signers([rival]).rpc();

    const now = Math.floor(Date.now() / 1000);
    if (ROUND - (now % ROUND) < 8) await sleep((ROUND - (now % ROUND) + 1) * 1000);
    const round = Math.floor(Date.now() / 1000 / ROUND);
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

    await deploy(player, playerPda, (1 << 25) - 1, 10_000_000); // 0.01 SOL on every block
    await deploy(rival, rivalPda, 1, 10_000_000); // 0.01 on block 0...
    await deploy(rival, rivalPda, 1, 10_000_000); // ...topped up to 0.02
    const before = await acc.pot.fetch(pot);
    expect(before.total.toNumber()).to.eq(270_000_000);
    expect(before.perBlock[0].toNumber()).to.eq(30_000_000);
    expect(before.miners).to.eq(2);

    await sleep((ROUND - (Math.floor(Date.now() / 1000) % ROUND) + 1) * 1000);
    const roundPda = find(Buffer.from('round'), u64le(round));
    await program.methods
      .revealRound(new anchor.BN(round))
      .accountsStrict({ payer: provider.wallet.publicKey, config, round: roundPda, slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
      .rpc();
    const r = await acc.round.fetch(roundPda);
    const rewardsBefore = await skrOf(rewards);
    await program.methods
      .settlePot(new anchor.BN(round))
      .accountsStrict({ config, round: roundPda, pot, feeTo: provider.wallet.publicKey, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    const settled = await acc.pot.fetch(pot);
    expect(settled.settled).to.eq(true);
    expect(settled.pool.toNumber()).to.eq(243_000_000); // 10% SOL fee
    expect(settled.skrReward.toNumber()).to.be.gte(25_000_000); // + Motherlode if it hit
    expect(rewardsBefore - (await skrOf(rewards))).to.eq(25_000_000);

    const rivalAta = (await getOrCreateAssociatedTokenAccount(conn, (provider.wallet as anchor.Wallet).payer, mint, rival.publicKey)).address;
    const rent = await conn.getMinimumBalanceForRentExemption(8 + 32 + 32 + 8 + 25 * 8 + 1);
    const got: { sol: number; skr: number }[] = [];
    for (const [kp, pda, ataK] of [
      [player, playerPda, userAta],
      [rival, rivalPda, rivalAta],
    ] as const) {
      const sol0 = await conn.getBalance(kp.publicKey);
      const skr0 = await skrOf(ataK);
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
          skrMint: mint,
          potVault,
          ownerAta: ataK,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      got.push({ sol: (await conn.getBalance(kp.publicKey)) - sol0 - rent, skr: (await skrOf(ataK)) - skr0 });
      expect(await conn.getAccountInfo(stakeOf(kp.publicKey))).to.eq(null);
    }
    const reward = settled.skrReward.toNumber();
    if (r.winningBlock === 0) {
      expect(got[0].sol).to.be.closeTo(81_000_000, 1);
      expect(got[1].sol).to.be.closeTo(162_000_000, 1);
      expect(got[0].skr + got[1].skr).to.be.closeTo(reward, 1);
      expect(got[1].skr).to.be.closeTo(Math.floor((reward * 2) / 3), 1);
    } else {
      expect(got[0].sol).to.be.closeTo(243_000_000, 1);
      expect(got[0].skr).to.eq(reward);
      expect(got[1]).to.deep.eq({ sol: 0, skr: 0 });
    }
    // points: 40 x 25 / blocks covered, x1.25 for the player's staked SKR (+10,000 base on a motherlode)
    const p = await acc.player.fetch(playerPda);
    const q = await acc.player.fetch(rivalPda);
    const ml = r.motherlode ? 10_000 : 0;
    expect(p.solDeployed.toNumber()).to.eq(250_000_000);
    expect(p.rounds).to.eq(1);
    expect(q.rounds).to.eq(1); // two deploys, one round
    expect(p.wins).to.eq(1);
    expect(p.points.toNumber()).to.eq(Math.floor(((40 + ml) * 12_500) / 10_000));
    if (r.winningBlock === 0) {
      expect(q.wins).to.eq(1);
      expect(q.points.toNumber()).to.eq(1_000 + ml);
    } else expect(q.points.toNumber()).to.eq(0);
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

  const deployAs = async (signer: Keypair, lamports: number) => {
    const now = Math.floor(Date.now() / 1000);
    if (ROUND - (now % ROUND) < 6) await sleep((ROUND - (now % ROUND) + 1) * 1000);
    const round = Math.floor(Date.now() / 1000 / ROUND);
    await program.methods
      .deploy(new anchor.BN(round), 0b11, new anchor.BN(lamports))
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

  it('buys gear with SKR', async () => {
    const rewardsBefore = await skrOf(rewards);
    await program.methods
      .buyGear(1)
      .accountsStrict({ owner: player.publicKey, config, player: playerPda, skrMint: mint, userAta, treasury, motherlode, rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([player])
      .rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.gearMask & 2).to.eq(2);
    // 30% Motherlode Pool, 40% Rewards Pool, 30% treasury
    expect(await skrOf(treasury)).to.eq(15_000_000);
    expect(await skrOf(motherlode)).to.eq(15_000_000);
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

  it('unstakes SKR', async () => {
    await program.methods
      .unstakeSkr(new anchor.BN(1_000_000_000))
      .accountsStrict({
        owner: player.publicKey,
        config,
        player: playerPda,
        skrMint: mint,
        userAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player])
      .rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.stakedSkr.toNumber()).to.eq(0);
  });
});
