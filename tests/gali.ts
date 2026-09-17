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
        motherlodeSkr: new anchor.BN(500_000_000),
        motherlodePoolBps: 3_000,
        rewardsPoolBps: 4_000,
        potFeeBps: 1_000,
        minDeploy: new anchor.BN(1_000_000),
        roundRewardSkr: new anchor.BN(25_000_000),
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
    const rewardsBefore = await skrOf(rewards);
    await program.methods
      .settlePot(new anchor.BN(round))
      .accountsStrict({ config, round: roundPda, pot, feeTo: provider.wallet.publicKey, skrMint: mint, rewards, motherlode, potVault, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    const settled = await acc.pot.fetch(pot);
    expect(settled.settled).to.eq(true);
    expect(settled.pool.toNumber()).to.eq(675_000_000); // 10% SOL fee
    expect(settled.skrReward.toNumber()).to.be.gte(25_000_000); // + Motherlode if it hit
    expect(rewardsBefore - (await skrOf(rewards))).to.eq(25_000_000);

    const rivalAta = (await getOrCreateAssociatedTokenAccount(conn, (provider.wallet as anchor.Wallet).payer, mint, rival.publicKey)).address;
    const got: { sol: number; skr: number }[] = [];
    for (const [kp, pda, ataK] of [
      [player, playerPda, userAta],
      [rival, rivalPda, rivalAta],
    ] as const) {
      const sol0 = await conn.getBalance(kp.publicKey);
      const rent = await conn.getBalance(stakeOf(kp.publicKey)); // refunded to the payer on close
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
    const w = r.winningBlock;
    expect(settled.splitReward).to.eq(r.splitReward);
    console.log(`      round mode: ${r.splitReward ? 'split' : 'one lucky winner'} (block ${w}, lucky index ${settled.luckyIndex.toNumber()})`);
    expect(got[0].sol).to.be.closeTo(225_000_000, 1);
    expect(got[1].sol).to.be.closeTo(450_000_000, 1);
    if (r.splitReward) {
      expect(got[0].skr).to.be.closeTo(Math.floor(reward / 3), 1);
      expect(got[1].skr).to.be.closeTo(Math.floor((reward * 2) / 3), 1);
    } else {
      // on the winning block, lamports 0..10M belong to the player and 10M..30M to the rival
      const idx = settled.luckyIndex.toNumber();
      expect(idx).to.be.lessThan(30_000_000);
      const playerWins = idx < 10_000_000;
      expect(got[0].skr).to.eq(playerWins ? reward : 0);
      expect(got[1].skr).to.eq(playerWins ? 0 : reward);
    }
    expect((await acc.stake.fetchNullable(stakeOf(player.publicKey)))).to.eq(null);
    void w;

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
