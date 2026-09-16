//! Gali: a mining game for Solana Seeker.
//!
//! * Rounds are derived from the clock: `round_id = unix_ts / round_secs`. No crank needed to open a round.
//! * Players `deploy` SOL on 1 to 25 blocks of the current round (from their wallet or a session key).
//! * After a round ends, anyone can `reveal_round`, which fixes the winning block and the 1-in-625
//!   motherlode. Anyone can then `settle_pot`: the SOL fee goes to the treasury wallet and the round's
//!   SKR (the per-round reward, plus the Motherlode on a motherlode round) moves into escrow.
//! * `claim_pot` pays each stake its share of the winning block: SOL pool and SKR pro rata, plus
//!   points scaled by 25 / blocks covered (boosted by staked SKR). Nobody on the winning block means
//!   the whole SOL pot is fee and no SKR leaves the pools.
//! * SKR can't be minted by the game: gear sales (bought with SKR) and top-ups fill the Motherlode
//!   and Rewards Pools.
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
pub const MAX_GEAR: usize = 32;
pub const MAX_POT_FEE_BPS: u16 = 2_000;

#[program]
pub mod gali {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: ConfigArgs) -> Result<()> {
        require!(args.round_secs >= 15, GaliError::BadConfig);
        require!(args.gear_prices.len() <= MAX_GEAR, GaliError::BadConfig);
        require!(args.motherlode_pool_bps as u64 <= BPS, GaliError::BadConfig);
        require!(args.pot_fee_bps <= MAX_POT_FEE_BPS, GaliError::BadConfig);
        require!(args.motherlode_pool_bps as u64 + args.rewards_pool_bps as u64 <= BPS, GaliError::BadConfig);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.skr_mint = ctx.accounts.skr_mint.key();
        c.round_secs = args.round_secs;
        c.base_points = args.base_points;
        c.motherlode_points = args.motherlode_points;
        c.boost_tier1 = args.boost_tier1;
        c.boost_tier2 = args.boost_tier2;
        c.gear_prices = args.gear_prices;
        c.motherlode_skr = args.motherlode_skr;
        c.motherlode_pool_bps = args.motherlode_pool_bps;
        c.rewards_pool_bps = args.rewards_pool_bps;
        c.pot_fee_bps = args.pot_fee_bps;
        c.min_deploy = args.min_deploy;
        c.round_reward_skr = args.round_reward_skr;
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

    /// Authorise a device-held session key to deploy SOL (and pay rent) for this player,
    /// so the phone doesn't ask the wallet to sign every round. Optionally funds it with SOL to deploy.
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

    /// Put `lamports_per_block` SOL on every block in `mask` for the current round.
    /// Signed by the owner or their active session key (the SOL comes from the signer).
    pub fn deploy(ctx: Context<Deploy>, round_id: u64, mask: u32, lamports_per_block: u64) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        {
            let p = &ctx.accounts.player;
            let is_owner = signer == p.owner;
            let is_session = signer == p.session && p.session != Pubkey::default() && now < p.session_expires;
            require!(is_owner || is_session, GaliError::NotAuthorised);
        }
        let current = (now / cfg.round_secs as i64) as u64;
        require!(round_id == current, GaliError::WrongRound);
        require!((current as i64 + 1) * cfg.round_secs as i64 - now > LOCK_SECS, GaliError::RoundLocked);
        require!(mask != 0 && mask & !ALL_BLOCKS_MASK == 0, GaliError::BadMask);
        require!(lamports_per_block >= cfg.min_deploy.max(1), GaliError::BadAmount);
        let total = lamports_per_block.checked_mul(mask.count_ones() as u64).ok_or(GaliError::BadAmount)?;

        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.signer.to_account_info(),
                    to: ctx.accounts.pot.to_account_info(),
                },
            ),
            total,
        )?;

        let owner = ctx.accounts.player.owner;
        let pot = &mut ctx.accounts.pot;
        if pot.round_id == 0 && pot.total == 0 {
            pot.round_id = round_id;
            pot.bump = ctx.bumps.pot;
        }
        let boost = boost_bps(cfg, ctx.accounts.player.staked_skr);
        let st = &mut ctx.accounts.stake;
        let first_in_round = st.owner == Pubkey::default();
        if first_in_round {
            st.owner = owner;
            st.payer = signer;
            st.round_id = round_id;
            st.boost_bps = boost;
            st.bump = ctx.bumps.stake;
            pot.miners = pot.miners.saturating_add(1);
        }
        for i in 0..BLOCKS as usize {
            if mask & (1 << i) != 0 {
                pot.per_block[i] = pot.per_block[i].checked_add(lamports_per_block).ok_or(GaliError::BadAmount)?;
                st.per_block[i] = st.per_block[i].checked_add(lamports_per_block).ok_or(GaliError::BadAmount)?;
            }
        }
        pot.total = pot.total.checked_add(total).ok_or(GaliError::BadAmount)?;
        let p = &mut ctx.accounts.player;
        p.sol_deployed = p.sol_deployed.saturating_add(total);
        if first_in_round {
            let today = (now / SECONDS_PER_DAY) as u32;
            if p.day != today {
                p.streak = if p.day + 1 == today { p.streak.saturating_add(1) } else { 1 };
                p.day = today;
            }
            p.rounds = p.rounds.saturating_add(1);
            p.xp = p.xp.saturating_add(10 + mask.count_ones() as u64);
        }
        emit!(Deployed { owner, round_id, mask, lamports_per_block, pot_total: pot.total });
        Ok(())
    }

    /// Permissionless, once per revealed round: pays the SOL fee, escrows the round's SKR reward.
    pub fn settle_pot(ctx: Context<SettlePot>, _round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let r = &ctx.accounts.round;
        let win = r.winning_block as usize;
        let has_winners = ctx.accounts.pot.per_block[win] > 0;
        require!(!ctx.accounts.pot.settled, GaliError::AlreadySettled);

        let total = ctx.accounts.pot.total;
        let fee = if has_winners { ((total as u128 * cfg.pot_fee_bps as u128) / BPS as u128) as u64 } else { total };
        if fee > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_to.to_account_info().try_borrow_mut_lamports()? += fee;
        }

        // SKR mined this round (+ the Motherlode on a motherlode round), capped by what the pools hold
        let mut skr = 0u64;
        let mut motherlode_part = 0u64;
        if has_winners {
            let bump = cfg.bump;
            let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
            let decimals = ctx.accounts.skr_mint.decimals;
            let from_rewards = cfg.round_reward_skr.min(ctx.accounts.rewards.amount);
            let from_motherlode = if r.motherlode { cfg.motherlode_skr.min(ctx.accounts.motherlode.amount) } else { 0 };
            for (amount, src) in [
                (from_rewards, ctx.accounts.rewards.to_account_info()),
                (from_motherlode, ctx.accounts.motherlode.to_account_info()),
            ] {
                if amount == 0 {
                    continue;
                }
                token_interface::transfer_checked(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: src,
                            mint: ctx.accounts.skr_mint.to_account_info(),
                            to: ctx.accounts.pot_vault.to_account_info(),
                            authority: ctx.accounts.config.to_account_info(),
                        },
                        signer,
                    ),
                    amount,
                    decimals,
                )?;
            }
            skr = from_rewards + from_motherlode;
            motherlode_part = from_motherlode;
        }

        let pot = &mut ctx.accounts.pot;
        pot.pool = total - fee;
        pot.skr_reward = skr;
        pot.motherlode_skr = motherlode_part;
        pot.motherlode = r.motherlode;
        pot.settled = true;
        emit!(PotSettled { round_id: pot.round_id, winning_block: win as u8, total, fee, pool: pot.pool, skr_reward: skr });
        Ok(())
    }

    /// Permissionless: pays a stake its share of the SOL pool and SKR reward (0 if it missed), then closes it.
    pub fn claim_pot(ctx: Context<ClaimPot>, _round_id: u64) -> Result<()> {
        let win = ctx.accounts.round.winning_block as usize;
        require!(ctx.accounts.pot.settled, GaliError::NotSettled);
        let mine = ctx.accounts.stake.per_block[win] as u128;
        let on_win = ctx.accounts.pot.per_block[win] as u128;
        let won = mine > 0 && on_win > 0;
        let (sol, skr, from_motherlode) = if won {
            (
                (mine * ctx.accounts.pot.pool as u128 / on_win) as u64,
                (mine * ctx.accounts.pot.skr_reward as u128 / on_win) as u64,
                (mine * ctx.accounts.pot.motherlode_skr as u128 / on_win) as u64,
            )
        } else {
            (0, 0, 0)
        };
        let points = if won {
            let cfg = &ctx.accounts.config;
            let covered = ctx.accounts.stake.per_block.iter().filter(|v| **v > 0).count() as u64;
            let mut base = cfg.base_points.saturating_mul(BLOCKS as u64) / covered.max(1);
            if ctx.accounts.pot.motherlode {
                base = base.saturating_add(cfg.motherlode_points);
            }
            base.saturating_mul(ctx.accounts.stake.boost_bps as u64) / BPS
        } else {
            0
        };
        let round_id = ctx.accounts.pot.round_id;
        if sol > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= sol;
            **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += sol;
        }
        if skr > 0 {
            let bump = ctx.accounts.config.bump;
            let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.pot_vault.to_account_info(),
                        mint: ctx.accounts.skr_mint.to_account_info(),
                        to: ctx.accounts.owner_ata.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                skr,
                ctx.accounts.skr_mint.decimals,
            )?;
        }
        let p = &mut ctx.accounts.player;
        if won {
            p.sol_won = p.sol_won.saturating_add(sol);
            p.skr_mined = p.skr_mined.saturating_add(skr - from_motherlode);
            p.skr_won = p.skr_won.saturating_add(from_motherlode);
            p.points = p.points.saturating_add(points);
            p.wins = p.wins.saturating_add(1);
            p.xp = p.xp.saturating_add(50);
        }
        emit!(PotClaimed { owner: p.owner, round_id, won, sol, skr, points });
        Ok(())
    }

    /// Anyone (team, sponsors, partners) can add SKR to the Rewards Pool that pays miners each round.
    pub fn fund_rewards(ctx: Context<FundRewards>, amount: u64) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_ata.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.rewards.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.skr_mint.decimals,
        )?;
        emit!(RewardsFunded { funder: ctx.accounts.funder.key(), amount });
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

    /// Anyone (team, sponsors, partners) can add SKR to the Motherlode Pool.
    pub fn fund_motherlode(ctx: Context<FundMotherlode>, amount: u64) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_ata.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.motherlode.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.skr_mint.decimals,
        )?;
        emit!(MotherlodeFunded { funder: ctx.accounts.funder.key(), amount });
        Ok(())
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
        require!((item as usize) < MAX_GEAR, GaliError::UnknownItem);
        require!(p.gear_mask & (1u32 << item) == 0, GaliError::AlreadyOwned);
        if price > 0 {
            let to_motherlode = price.saturating_mul(cfg.motherlode_pool_bps as u64) / BPS;
            let to_rewards = price.saturating_mul(cfg.rewards_pool_bps as u64) / BPS;
            let to_treasury = price - to_motherlode - to_rewards;
            let decimals = ctx.accounts.skr_mint.decimals;
            for (amount, dest) in [
                (to_motherlode, ctx.accounts.motherlode.to_account_info()),
                (to_rewards, ctx.accounts.rewards.to_account_info()),
                (to_treasury, ctx.accounts.treasury.to_account_info()),
            ] {
                if amount == 0 {
                    continue;
                }
                token_interface::transfer_checked(
                    CpiContext::new(
                        ctx.accounts.token_program.to_account_info(),
                        TransferChecked {
                            from: ctx.accounts.user_ata.to_account_info(),
                            mint: ctx.accounts.skr_mint.to_account_info(),
                            to: dest,
                            authority: ctx.accounts.owner.to_account_info(),
                        },
                    ),
                    amount,
                    decimals,
                )?;
            }
        }
        p.gear_mask |= 1u32 << item;
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
    pub base_points: u64,
    pub motherlode_points: u64,
    /// raw SKR amounts (with decimals) for the 1.25x and 1.5x boosts
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    /// raw SKR price per gear item, index = item id (bit in Player::gear_mask)
    #[max_len(32)]
    pub gear_prices: Vec<u64>,
    /// raw SKR paid to each winner of a motherlode round (capped by the pool balance)
    pub motherlode_skr: u64,
    /// share of every gear sale routed to the Motherlode Pool, in bps
    pub motherlode_pool_bps: u16,
    /// share of every gear sale routed to the Rewards Pool, in bps (the rest goes to the treasury)
    pub rewards_pool_bps: u16,
    /// SOL fee on each round's pot, in bps (sent to the authority / treasury wallet)
    pub pot_fee_bps: u16,
    /// minimum lamports per block for `deploy`
    pub min_deploy: u64,
    /// raw SKR mined per round, split between the miners on the winning block
    pub round_reward_skr: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub round_secs: u32,
    pub base_points: u64,
    pub motherlode_points: u64,
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    pub gear_prices: Vec<u64>,
    pub motherlode_skr: u64,
    pub motherlode_pool_bps: u16,
    pub rewards_pool_bps: u16,
    pub pot_fee_bps: u16,
    pub min_deploy: u64,
    pub round_reward_skr: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub owner: Pubkey,
    pub points: u64,
    pub xp: u64,
    pub wins: u32,
    /// rounds played (first deploy in a round)
    pub rounds: u32,
    /// UTC day of the last round played, and the consecutive-day streak
    pub day: u32,
    pub streak: u16,
    pub staked_skr: u64,
    pub gear_mask: u32,
    pub session: Pubkey,
    pub session_expires: i64,
    /// lifetime raw SKR won from the Motherlode Pool
    pub skr_won: u64,
    /// lifetime lamports deployed / won, and raw SKR mined from rounds
    pub sol_deployed: u64,
    pub sol_won: u64,
    pub skr_mined: u64,
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

/// One per round: SOL on each block (the lamports sit in this account).
#[account]
#[derive(InitSpace)]
pub struct Pot {
    pub round_id: u64,
    pub per_block: [u64; 25],
    pub total: u64,
    /// lamports winners split after the fee (set by `settle_pot`)
    pub pool: u64,
    /// raw SKR winners split (escrowed in `pot_vault` by `settle_pot`);
    /// `motherlode_skr` of it came from the Motherlode Pool
    pub skr_reward: u64,
    pub motherlode_skr: u64,
    pub motherlode: bool,
    pub miners: u32,
    pub settled: bool,
    pub bump: u8,
}

/// One per player per round: their lamports on each block.
#[account]
#[derive(InitSpace)]
pub struct Stake {
    pub owner: Pubkey,
    /// who paid rent for this account; refunded on claim
    pub payer: Pubkey,
    pub round_id: u64,
    pub per_block: [u64; 25],
    /// points boost locked in at the player's first deploy of the round
    pub boost_bps: u16,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Config>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init, payer = authority, seeds = [b"vault"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"treasury"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"motherlode"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"rewards"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"pot_vault"], bump,
        token::mint = skr_mint, token::authority = config, token::token_program = token_program
    )]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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
pub struct Deploy<'info> {
    /// the player's wallet or their active session key; the SOL and rent come from here
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: identity only; bound to `player` via has_one and PDA seeds
    pub owner: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Box<Account<'info, Player>>,
    #[account(
        init_if_needed, payer = signer, space = 8 + Pot::INIT_SPACE,
        seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump
    )]
    pub pot: Box<Account<'info, Pot>>,
    #[account(
        init_if_needed, payer = signer, space = 8 + Stake::INIT_SPACE,
        seeds = [b"stake", owner.key().as_ref(), &round_id.to_le_bytes()], bump
    )]
    pub stake: Box<Account<'info, Stake>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct SettlePot<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut, seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump = pot.bump)]
    pub pot: Box<Account<'info, Pot>>,
    /// CHECK: SOL fee destination, pinned to the config authority (treasury wallet)
    #[account(mut, address = config.authority)]
    pub fee_to: UncheckedAccount<'info>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"rewards"], bump)]
    pub rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"motherlode"], bump)]
    pub motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"pot_vault"], bump)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimPot<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: receives the SOL payout; must be the stake's owner
    #[account(mut, address = stake.owner)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: rent refund destination, must match the stake's payer
    #[account(mut, address = stake.payer)]
    pub payer: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Box<Account<'info, Player>>,
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut, seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump = pot.bump)]
    pub pot: Box<Account<'info, Pot>>,
    #[account(
        mut, close = payer,
        seeds = [b"stake", owner.key().as_ref(), &round_id.to_le_bytes()], bump = stake.bump
    )]
    pub stake: Box<Account<'info, Stake>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"pot_vault"], bump)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = cranker,
        associated_token::mint = skr_mint, associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundRewards<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = skr_mint, token::authority = funder, token::token_program = token_program)]
    pub funder_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"rewards"], bump)]
    pub rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
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
pub struct FundMotherlode<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = skr_mint, token::authority = funder, token::token_program = token_program)]
    pub funder_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"motherlode"], bump)]
    pub motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
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
    #[account(mut, seeds = [b"motherlode"], bump)]
    pub motherlode: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"rewards"], bump)]
    pub rewards: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

/* ---------------- events + errors ---------------- */

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
pub struct Deployed {
    pub owner: Pubkey,
    pub round_id: u64,
    pub mask: u32,
    pub lamports_per_block: u64,
    pub pot_total: u64,
}

#[event]
pub struct PotSettled {
    pub round_id: u64,
    pub winning_block: u8,
    pub total: u64,
    pub fee: u64,
    pub pool: u64,
    pub skr_reward: u64,
}

#[event]
pub struct PotClaimed {
    pub owner: Pubkey,
    pub round_id: u64,
    pub won: bool,
    pub sol: u64,
    pub skr: u64,
    pub points: u64,
}

#[event]
pub struct RewardsFunded {
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct MotherlodeFunded {
    pub funder: Pubkey,
    pub amount: u64,
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
    #[msg("This pot is already settled")]
    AlreadySettled,
    #[msg("Settle the pot first")]
    NotSettled,
}
