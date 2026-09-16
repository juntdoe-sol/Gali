//! Gali: a mining game for Solana Seeker.
//!
//! * Rounds are derived from the clock: `round_id = unix_ts / round_secs`. No crank needed to open a round.
//! * Players get a number of free digs per UTC day. A dig marks up to 25 blocks for the current round.
//! * After a round ends, anyone can `reveal_round`, which fixes the winning block.
//! * Players `claim` their dig: covering the winning block pays points scaled by 25 / blocks covered,
//!   so the expected value is the same whatever you pick. A 1-in-625 motherlode pays a bonus.
//! * SKR staked in the game vault boosts points. SKR buys cosmetic gear (sent to the treasury).
//!
//! Randomness: devnet build uses the most recent SlotHashes entry mixed with the round id.
//! This is leader-influenceable and must be replaced with a VRF before any mainnet use.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hashv, sysvar::slot_hashes};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV");

pub const BLOCKS: u32 = 25;
pub const ALL_BLOCKS_MASK: u32 = (1 << BLOCKS) - 1;
pub const LOCK_SECS: i64 = 3;
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const MOTHERLODE_ODDS: u64 = 625;
pub const BPS: u64 = 10_000;
pub const MAX_SESSION_SECS: i64 = 7 * SECONDS_PER_DAY;
pub const MAX_SESSION_FUND: u64 = 1_000_000_000; // 1 SOL

#[program]
pub mod gali {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: ConfigArgs) -> Result<()> {
        require!(args.round_secs >= 15, GaliError::BadConfig);
        require!(args.daily_free_digs > 0, GaliError::BadConfig);
        require!(args.gear_prices.len() <= 16, GaliError::BadConfig);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.skr_mint = ctx.accounts.skr_mint.key();
        c.round_secs = args.round_secs;
        c.daily_free_digs = args.daily_free_digs;
        c.base_points = args.base_points;
        c.motherlode_points = args.motherlode_points;
        c.boost_tier1 = args.boost_tier1;
        c.boost_tier2 = args.boost_tier2;
        c.gear_prices = args.gear_prices;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn init_player(ctx: Context<InitPlayer>) -> Result<()> {
        let p = &mut ctx.accounts.player;
        p.owner = ctx.accounts.owner.key();
        p.gear_mask = 1; // starter pickaxe
        p.bump = ctx.bumps.player;
        Ok(())
    }

    /// Authorise a device-held session key to dig (and pay rent) for this player,
    /// so the phone doesn't ask the wallet to sign every round. Optionally funds it.
    pub fn set_session(ctx: Context<SetSession>, session: Pubkey, expires_at: i64, fund_lamports: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at <= now + MAX_SESSION_SECS, GaliError::BadSession);
        let p = &mut ctx.accounts.player;
        p.session = session;
        p.session_expires = expires_at;
        if fund_lamports > 0 {
            require!(fund_lamports <= MAX_SESSION_FUND, GaliError::BadAmount);
            require_keys_eq!(ctx.accounts.session.key(), session, GaliError::BadSession);
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.session.to_account_info(),
                    },
                ),
                fund_lamports,
            )?;
        }
        emit!(SessionSet { owner: p.owner, session, expires_at });
        Ok(())
    }

    pub fn dig(ctx: Context<Dig>, round_id: u64, mask: u32) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        {
            let p = &ctx.accounts.player;
            let now = Clock::get()?.unix_timestamp;
            let is_owner = signer == p.owner;
            let is_session = signer == p.session && p.session != Pubkey::default() && now < p.session_expires;
            require!(is_owner || is_session, GaliError::NotAuthorised);
        }
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let current = (now / cfg.round_secs as i64) as u64;
        require!(round_id == current, GaliError::WrongRound);
        let round_end = (current as i64 + 1) * cfg.round_secs as i64;
        require!(round_end - now > LOCK_SECS, GaliError::RoundLocked);
        require!(mask != 0 && mask & !ALL_BLOCKS_MASK == 0, GaliError::BadMask);

        let p = &mut ctx.accounts.player;
        let today = (now / SECONDS_PER_DAY) as u32;
        if p.day != today {
            p.streak = if p.day + 1 == today { p.streak.saturating_add(1) } else { 1 };
            p.day = today;
            p.digs_today = 0;
        }
        require!(p.digs_today < cfg.daily_free_digs, GaliError::OutOfDigs);
        p.digs_today += 1;
        p.digs = p.digs.saturating_add(1);
        p.xp = p.xp.saturating_add(10 + mask.count_ones() as u64);

        let d = &mut ctx.accounts.dig;
        d.owner = p.owner;
        d.payer = signer;
        d.round_id = round_id;
        d.mask = mask;
        d.boost_bps = boost_bps(cfg, p.staked_skr);
        d.bump = ctx.bumps.dig;

        emit!(Dug { owner: p.owner, round_id, mask, boost_bps: d.boost_bps });
        Ok(())
    }

    pub fn reveal_round(ctx: Context<RevealRound>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let round_end = (round_id as i64 + 1) * cfg.round_secs as i64;
        require!(now >= round_end, GaliError::RoundNotOver);

        // SlotHashes layout: u64 len, then (u64 slot, [u8;32] hash) entries, newest first.
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        require!(data.len() >= 48, GaliError::NoEntropy);
        let recent = &data[16..48];
        let seed = hashv(&[recent, &round_id.to_le_bytes(), b"gali"]).to_bytes();
        let a = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let b = u64::from_le_bytes(seed[8..16].try_into().unwrap());

        let r = &mut ctx.accounts.round;
        r.round_id = round_id;
        r.winning_block = (a % BLOCKS as u64) as u8;
        r.motherlode = b % MOTHERLODE_ODDS == 0;
        r.revealed_at = now;
        r.bump = ctx.bumps.round;
        emit!(Revealed { round_id, winning_block: r.winning_block, motherlode: r.motherlode });
        Ok(())
    }

    pub fn claim(ctx: Context<Claim>, _round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let r = &ctx.accounts.round;
        let d = &ctx.accounts.dig;
        let p = &mut ctx.accounts.player;
        let covered = d.mask.count_ones() as u64;
        let won = d.mask & (1 << r.winning_block) != 0;
        let mut points = 0u64;
        if won {
            let mut base = cfg.base_points.saturating_mul(BLOCKS as u64) / covered.max(1);
            if r.motherlode {
                base = base.saturating_add(cfg.motherlode_points);
            }
            points = base.saturating_mul(d.boost_bps as u64) / BPS;
            p.points = p.points.saturating_add(points);
            p.wins = p.wins.saturating_add(1);
            p.xp = p.xp.saturating_add(50);
        }
        emit!(Claimed { owner: p.owner, round_id: r.round_id, won, points });
        Ok(()) // dig account is closed back to the owner by the `close` constraint
    }

    pub fn stake_skr(ctx: Context<StakeSkr>, amount: u64) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_ata.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.skr_mint.decimals,
        )?;
        let p = &mut ctx.accounts.player;
        p.staked_skr = p.staked_skr.checked_add(amount).ok_or(GaliError::BadAmount)?;
        emit!(Staked { owner: p.owner, amount, total: p.staked_skr });
        Ok(())
    }

    pub fn unstake_skr(ctx: Context<UnstakeSkr>, amount: u64) -> Result<()> {
        let p = &mut ctx.accounts.player;
        require!(amount > 0 && amount <= p.staked_skr, GaliError::BadAmount);
        p.staked_skr -= amount;
        let bump = ctx.accounts.config.bump;
        let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.skr_mint.decimals,
        )?;
        emit!(Staked { owner: p.owner, amount: 0, total: p.staked_skr });
        Ok(())
    }

    pub fn buy_gear(ctx: Context<BuyGear>, item: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let price = *cfg.gear_prices.get(item as usize).ok_or(GaliError::UnknownItem)?;
        let p = &mut ctx.accounts.player;
        require!(p.gear_mask & (1 << item) == 0, GaliError::AlreadyOwned);
        if price > 0 {
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_ata.to_account_info(),
                        mint: ctx.accounts.skr_mint.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                price,
                ctx.accounts.skr_mint.decimals,
            )?;
        }
        p.gear_mask |= 1 << item;
        emit!(GearBought { owner: p.owner, item, price });
        Ok(())
    }
}

fn boost_bps(cfg: &Config, staked: u64) -> u16 {
    if cfg.boost_tier2 > 0 && staked >= cfg.boost_tier2 {
        15_000
    } else if cfg.boost_tier1 > 0 && staked >= cfg.boost_tier1 {
        12_500
    } else {
        10_000
    }
}

/* ---------------- accounts ---------------- */

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub skr_mint: Pubkey,
    pub round_secs: u32,
    pub daily_free_digs: u16,
    pub base_points: u64,
    pub motherlode_points: u64,
    /// raw SKR amounts (with decimals) for the 1.25x and 1.5x boosts
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    /// raw SKR price per gear item, index = item id
    #[max_len(16)]
    pub gear_prices: Vec<u64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub round_secs: u32,
    pub daily_free_digs: u16,
    pub base_points: u64,
    pub motherlode_points: u64,
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    pub gear_prices: Vec<u64>,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub points: u64,
    pub xp: u64,
    pub wins: u32,
    pub digs: u32,
    pub day: u32,
    pub digs_today: u16,
    pub streak: u16,
    pub staked_skr: u64,
    pub gear_mask: u32,
    pub session: Pubkey,
    pub session_expires: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct DigTicket {
    pub owner: Pubkey,
    /// who paid rent for this ticket; refunded on claim
    pub payer: Pubkey,
    pub round_id: u64,
    pub mask: u32,
    pub boost_bps: u16,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub round_id: u64,
    pub winning_block: u8,
    pub motherlode: bool,
    pub revealed_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init, payer = authority, seeds = [b"vault"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init, payer = authority, seeds = [b"treasury"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitPlayer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Player::INIT_SPACE, seeds = [b"player", owner.key().as_ref()], bump)]
    pub player: Account<'info, Player>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    /// CHECK: only receives lamports; must equal the `session` argument when funding.
    #[account(mut)]
    pub session: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct Dig<'info> {
    /// the player's wallet or their active session key; pays rent for the ticket
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: identity only; bound to `player` via has_one and PDA seeds
    pub owner: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    #[account(
        init, payer = signer, space = 8 + DigTicket::INIT_SPACE,
        seeds = [b"dig", owner.key().as_ref(), &round_id.to_le_bytes()], bump
    )]
    pub dig: Account<'info, DigTicket>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RevealRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init, payer = payer, space = 8 + Round::INIT_SPACE,
        seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: address-constrained to the SlotHashes sysvar; only raw bytes are read.
    #[account(address = slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct Claim<'info> {
    /// anyone can settle a revealed dig; points always go to the owner's player account
    pub cranker: Signer<'info>,
    /// CHECK: identity only; bound via has_one
    pub owner: UncheckedAccount<'info>,
    /// CHECK: rent refund destination, must match the ticket's payer
    #[account(mut, address = dig.payer)]
    pub payer: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Account<'info, Round>,
    #[account(
        mut, close = payer, has_one = owner,
        seeds = [b"dig", owner.key().as_ref(), &round_id.to_le_bytes()], bump = dig.bump
    )]
    pub dig: Account<'info, DigTicket>,
}

#[derive(Accounts)]
pub struct StakeSkr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = skr_mint, token::authority = owner, token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct UnstakeSkr<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed, payer = owner,
        associated_token::mint = skr_mint, associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyGear<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub skr_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = skr_mint, token::authority = owner, token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/* ---------------- events + errors ---------------- */

#[event]
pub struct Dug {
    pub owner: Pubkey,
    pub round_id: u64,
    pub mask: u32,
    pub boost_bps: u16,
}

#[event]
pub struct SessionSet {
    pub owner: Pubkey,
    pub session: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct Revealed {
    pub round_id: u64,
    pub winning_block: u8,
    pub motherlode: bool,
}

#[event]
pub struct Claimed {
    pub owner: Pubkey,
    pub round_id: u64,
    pub won: bool,
    pub points: u64,
}

#[event]
pub struct Staked {
    pub owner: Pubkey,
    pub amount: u64,
    pub total: u64,
}

#[event]
pub struct GearBought {
    pub owner: Pubkey,
    pub item: u8,
    pub price: u64,
}

#[error_code]
pub enum GaliError {
    #[msg("Invalid config")]
    BadConfig,
    #[msg("That round isn't open")]
    WrongRound,
    #[msg("This round is locked; wait for the next one")]
    RoundLocked,
    #[msg("Pick between 1 and 25 blocks")]
    BadMask,
    #[msg("No free digs left today")]
    OutOfDigs,
    #[msg("Round hasn't ended yet")]
    RoundNotOver,
    #[msg("No slot hash available")]
    NoEntropy,
    #[msg("Invalid amount")]
    BadAmount,
    #[msg("Unknown gear item")]
    UnknownItem,
    #[msg("You already own this item")]
    AlreadyOwned,
    #[msg("Signer is not the player or an active session")]
    NotAuthorised,
    #[msg("Invalid session")]
    BadSession,
}
