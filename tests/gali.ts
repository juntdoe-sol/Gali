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
        dailyFreeDigs: 2,
        basePoints: new anchor.BN(40),
        motherlodePoints: new anchor.BN(10_000),
        boostTier1: new anchor.BN(1_000_000_000),
        boostTier2: new anchor.BN(10_000_000_000),
        gearPrices: [new anchor.BN(0), new anchor.BN(50_000_000)],
        motherlodeSkr: new anchor.BN(500_000_000),
        motherlodePoolBps: 5_000,
      })
      .accountsStrict({
        authority: provider.wallet.publicKey,
        config,
        skrMint: mint,
        vault,
        treasury,
        motherlode,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
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

  it('digs, reveals and claims a round', async () => {
    // wait until we're early in a round
    let now = Math.floor(Date.now() / 1000);
    if (ROUND - (now % ROUND) < 8) await sleep((ROUND - (now % ROUND) + 1) * 1000);
    now = Math.floor(Date.now() / 1000);
    const round = Math.floor(now / ROUND);
    const dig = find(Buffer.from('dig'), player.publicKey.toBuffer(), u64le(round));
    const mask = (1 << 25) - 1; // cover every block: guaranteed win
    await program.methods
      .dig(new anchor.BN(round), mask)
      .accountsStrict({ signer: player.publicKey, owner: player.publicKey, config, player: playerPda, dig, systemProgram: SystemProgram.programId })
      .signers([player])
      .rpc();
    const t = await acc.digTicket.fetch(dig);
    expect(t.boostBps).to.eq(12_500);

    // reveal before the end must fail
    const roundPda = find(Buffer.from('round'), u64le(round));
    const reveal = () =>
      program.methods
        .revealRound(new anchor.BN(round))
        .accountsStrict({ payer: provider.wallet.publicKey, config, round: roundPda, slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
        .rpc();
    let failed = false;
    try {
      await reveal();
    } catch {
      failed = true;
    }
    expect(failed).to.eq(true);

    await sleep((ROUND - (Math.floor(Date.now() / 1000) % ROUND) + 1) * 1000);
    await reveal();
    await program.methods
      .claim(new anchor.BN(round))
      .accountsStrict({
        cranker: provider.wallet.publicKey,
        owner: player.publicKey,
        payer: player.publicKey,
        config,
        player: playerPda,
        round: roundPda,
        dig,
        skrMint: mint,
        motherlode,
        ownerAta: userAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.wins).to.eq(1);
    expect(p.points.toNumber()).to.be.gte(50); // 40 * 25/25 * 1.25
    expect(await provider.connection.getAccountInfo(dig)).to.eq(null);
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

  it('rejects a random signer', async () => {
    const rando = Keypair.generate();
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(rando.publicKey, LAMPORTS_PER_SOL));
    const round = Math.floor(Date.now() / 1000 / ROUND);
    let err = '';
    try {
      await program.methods
        .dig(new anchor.BN(round), 1)
        .accountsStrict({ signer: rando.publicKey, owner: player.publicKey, config, player: playerPda, dig: find(Buffer.from('dig'), player.publicKey.toBuffer(), u64le(round)), systemProgram: SystemProgram.programId })
        .signers([rando])
        .rpc();
    } catch (e) {
      err = String(e);
    }
    expect(err).to.contain('NotAuthorised');
  });

  it('enforces the daily free dig limit (via session key)', async () => {
    const tryDig = async () => {
      let now = Math.floor(Date.now() / 1000);
      if (ROUND - (now % ROUND) < 6) await sleep((ROUND - (now % ROUND) + 1) * 1000);
      now = Math.floor(Date.now() / 1000);
      const round = Math.floor(now / ROUND);
      return program.methods
        .dig(new anchor.BN(round), 1)
        .accountsStrict({ signer: session.publicKey, owner: player.publicKey, config, player: playerPda, dig: find(Buffer.from('dig'), player.publicKey.toBuffer(), u64le(round)), systemProgram: SystemProgram.programId })
        .signers([session])
        .rpc();
    };
    await tryDig(); // 2nd dig of the day
    await sleep((ROUND - (Math.floor(Date.now() / 1000) % ROUND) + 1) * 1000);
    let err = '';
    try {
      await tryDig();
    } catch (e) {
      err = String(e);
    }
    expect(err).to.contain('OutOfDigs');
  });

  it('buys gear with SKR', async () => {
    await program.methods
      .buyGear(1)
      .accountsStrict({ owner: player.publicKey, config, player: playerPda, skrMint: mint, userAta, treasury, motherlode, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([player])
      .rpc();
    const p = await acc.player.fetch(playerPda);
    expect(p.gearMask & 2).to.eq(2);
    // 50% of the price feeds the Motherlode Pool
    expect(Number((await getAccount(provider.connection, treasury)).amount)).to.eq(25_000_000);
    expect(Number((await getAccount(provider.connection, motherlode)).amount)).to.eq(25_000_000);
  });

  it('lets anyone fund the Motherlode Pool', async () => {
    const payer = (provider.wallet as anchor.Wallet).payer;
    const funderAta = (await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, payer.publicKey)).address;
    await mintTo(provider.connection, payer, mint, funderAta, payer, 1_000_000_000n);
    await program.methods
      .fundMotherlode(new anchor.BN(1_000_000_000))
      .accountsStrict({ funder: payer.publicKey, config, skrMint: mint, funderAta, motherlode, tokenProgram: TOKEN_PROGRAM_ID })
      .rpc();
    expect(Number((await getAccount(provider.connection, motherlode)).amount)).to.eq(1_025_000_000);
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
