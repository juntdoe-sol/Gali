//! Gali: a mining game for Solana Seeker, played on ORE's board.
//!
//! Gali does not run a round. ORE does, on mainnet, in 200-slot rounds that start
//! on their first deploy. Players deploy into ORE's board, win the losing squares'
//! SOL and mine $ORE, and claim all of it from ORE's own program. Gali never sits
//! between a player and that position, never custodies it, and takes no cut of it.
//!
//! What this program is, then, is the game around that:
//!
//! * `record_ore_round` reads ORE's finished Round and the player's Miner account
//!   and awards points, wins, day streaks and XP from them. Permissionless, like
//!   ORE's own checkpoint, so a player who closes the app still gets credited, and
//!   a no-op on a round already recorded.
//! * `claim_skr_jackpot` pays Gali's SKR pool when ORE's motherlode hits, to the
//!   same winners, split by the same share of the winning square ORE used for the
//!   ORE. The first claim snapshots the pool so late claimers are not short-changed
//!   by a pool that grew while they waited.
//! * Gear (`buy_gear`, `buy_gear_ore`): cosmetics bought with SKR or ORE. Sales
//!   feed the Motherlode Pool and the treasury, so players fund the jackpot they
//!   are chasing.
//! * Staking (`stake_skr`, `stake_ore`): boosts the points a recorded round awards.
//!   The better of the two boosts applies rather than both.
//! * Admin: `update_config` (with hard caps), `set_paused`, `withdraw_treasury`
//!   (treasury tokens only; the pools and staked balances cannot be withdrawn), and
//!   a two-step authority hand-over.
//!
//! Gali mints nothing. Every SKR and ORE it pays out was bought in by a player or
//! funded by someone, and both pool balances are on-chain for anyone to read.
//!
//! Reading ORE: their program is built with Steel, so there is no IDL and no
//! generated client. `ore.rs` decodes their accounts at offsets confirmed against
//! live mainnet accounts, and refuses anything with the wrong owner, length or
//! derivation rather than decoding whatever sits at that address. `scripts/ore-probe.ts`
//! re-runs that check; run it after ORE redeploys.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

pub mod ore;

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
/// A round can take at most 1% of the Rewards Pool.
pub const MAX_DRIP_BPS: u16 = 100;
/// Fee on claimed unrefined SKR, shared with the players who keep theirs unclaimed.
pub const REFINING_FEE_BPS: u64 = 1_000;
/// Fixed-point scale for the refinery's per-SKR accumulator.
/// Round and pot accounts can be closed (rent back to whoever paid it) this long after the round ends.
#[cfg(not(feature = "fasttime"))]
pub const CLOSE_AFTER_SECS: i64 = SECONDS_PER_DAY;
/// If a round is still unrevealed this long after it ended, players can take their own SOL back.
#[cfg(not(feature = "fasttime"))]
pub const ABANDON_SECS: i64 = 3_600;
/// Test-only waiting periods, enabled by the `fasttime` feature so the suite can exercise
/// close_round and refund_stake without waiting a day. Never built for devnet or mainnet.
#[cfg(feature = "fasttime")]
pub const CLOSE_AFTER_SECS: i64 = 0;
#[cfg(feature = "fasttime")]
pub const ABANDON_SECS: i64 = 0;
/// SlotHashes keeps this many entries; past it a locked slot can never be revealed.
pub const SLOT_HASH_WINDOW: u64 = 512;
/// Paid by each player's first deploy of a round and handed to whoever claims their stake.
/// Taken from every spot, win or lose (sent to the treasury wallet).
/// Spots per round where the winner takes the whole SKR reward.
pub const SOLO_SPOTS: usize = 10;
/// `lock_round` targets the slot this many slots ahead.
pub const DRAW_DELAY_SLOTS: u64 = 5;
/// A lock can only be replaced once its slot has fallen out of SlotHashes, so a losing player can't
/// withhold the reveal and re-roll: by then nobody could have revealed it either.
pub const DRAW_EXPIRY_SLOTS: u64 = SLOT_HASH_WINDOW;




/// End of a round as a unix timestamp, rejecting round ids that can't exist.

fn check_config(cfg: &Config) -> Result<()> {
    require!(cfg.gear_prices_usd.len() <= MAX_GEAR, GaliError::BadConfig);
    require!(cfg.motherlode_pool_bps as u64 <= BPS, GaliError::BadConfig);
    require!(cfg.ore_motherlode_bps as u64 <= BPS, GaliError::BadConfig);
    require!(
        cfg.boost_tier2 == 0 || cfg.boost_tier2 >= cfg.boost_tier1,
        GaliError::BadConfig
    );
    require!(
        cfg.ore_boost_tier2 == 0 || cfg.ore_boost_tier2 >= cfg.ore_boost_tier1,
        GaliError::BadConfig
    );
    Ok(())
}

/// Raw token units for a price in millionths of a dollar.
///
/// `rate_micro` is what one whole token costs, in the same millionths, so the
/// decimals cancel out into the token's own smallest unit. Neither SKR nor ORE has
/// a Pyth feed, so the rate is set by the admin and the app shows a live Jupiter
/// quote beside it for anyone who wants to check the two against each other.
fn token_units(usd_micro: u64, rate_micro: u64, decimals: u8) -> Result<u64> {
    require!(rate_micro > 0, GaliError::PriceUnset);
    let scale = 10u128
        .checked_pow(decimals as u32)
        .ok_or(GaliError::BadConfig)?;
    let units = (usd_micro as u128)
        .checked_mul(scale)
        .ok_or(GaliError::BadAmount)?
        / rate_micro as u128;
    u64::try_from(units).map_err(|_| GaliError::BadAmount.into())
}

/// Refuses a sale priced off a rate nobody has touched in too long.
fn fresh_prices(cfg: &Config) -> Result<()> {
    if cfg.price_max_age_secs == 0 {
        return Ok(());
    }
    let age = Clock::get()?
        .unix_timestamp
        .saturating_sub(cfg.price_updated_at);
    require!(age <= cfg.price_max_age_secs as i64, GaliError::PriceStale);
    Ok(())
}

#[program]
pub mod gali {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: ConfigArgs) -> Result<()> {
        require!(args.gear_prices_usd.len() <= MAX_GEAR, GaliError::BadConfig);
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.skr_mint = ctx.accounts.skr_mint.key();
        c.ore_mint = ctx.accounts.ore_mint.key();
        c.base_points = args.base_points;
        c.motherlode_points = args.motherlode_points;
        c.boost_tier1 = args.boost_tier1;
        c.boost_tier2 = args.boost_tier2;
        c.ore_boost_tier1 = args.ore_boost_tier1;
        c.ore_boost_tier2 = args.ore_boost_tier2;
        c.gear_prices_usd = args.gear_prices_usd;
        c.skr_price_micro = args.skr_price_micro;
        c.ore_price_micro = args.ore_price_micro;
        c.price_updated_at = Clock::get()?.unix_timestamp;
        c.price_max_age_secs = args.price_max_age_secs;
        c.motherlode_pool_bps = args.motherlode_pool_bps;
        c.ore_motherlode_bps = args.ore_motherlode_bps;
        c.paused = false;
        c.pending_authority = Pubkey::default();
        c.bump = ctx.bumps.config;
        check_config(c)
    }

    /// Set what one whole SKR and one whole ORE cost, in millionths of a dollar.
    ///
    /// Gear is priced in dollars, so this is the only thing that decides how many
    /// tokens an item costs. It is admin-only and stamped with the time, and
    /// `price_max_age_secs` is what stops a forgotten rate from selling a $270 item
    /// for pennies after the token moves.
    pub fn set_token_prices(
        ctx: Context<AdminConfig>,
        skr_price_micro: u64,
        ore_price_micro: u64,
    ) -> Result<()> {
        require!(
            skr_price_micro > 0 && ore_price_micro > 0,
            GaliError::BadAmount
        );
        let c = &mut ctx.accounts.config;
        c.skr_price_micro = skr_price_micro;
        c.ore_price_micro = ore_price_micro;
        c.price_updated_at = Clock::get()?.unix_timestamp;
        emit!(TokenPricesSet {
            skr_price_micro,
            ore_price_micro,
            at: c.price_updated_at,
        });
        Ok(())
    }

    /* ---------------- admin ---------------- */

    /// Change game settings. Only fields that are `Some` change. `round_secs` and the mint are fixed.
    pub fn update_config(ctx: Context<AdminConfig>, u: ConfigUpdate) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(v) = u.base_points {
            c.base_points = v;
        }
        if let Some(v) = u.motherlode_points {
            c.motherlode_points = v;
        }
        if let Some(v) = u.boost_tier1 {
            c.boost_tier1 = v;
        }
        if let Some(v) = u.boost_tier2 {
            c.boost_tier2 = v;
        }
        if let Some(v) = u.ore_boost_tier1 {
            c.ore_boost_tier1 = v;
        }
        if let Some(v) = u.ore_boost_tier2 {
            c.ore_boost_tier2 = v;
        }
        if let Some(v) = u.gear_prices_usd {
            require!(v.len() <= MAX_GEAR, GaliError::BadConfig);
            c.gear_prices_usd = v;
        }
        if let Some(v) = u.price_max_age_secs {
            c.price_max_age_secs = v;
        }
        if let Some(v) = u.motherlode_pool_bps {
            c.motherlode_pool_bps = v;
        }
        if let Some(v) = u.ore_motherlode_bps {
            c.ore_motherlode_bps = v;
        }
        check_config(c)?;
        emit!(ConfigUpdated {
            authority: c.authority
        });
        Ok(())
    }

    /// Stop (or restart) new deploys and gear sales. Settling, claiming and unstaking always work.
    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedSet { paused });
        Ok(())
    }

    /// Move SKR from the treasury (the protocol's cut of gear sales) to any SKR account.
    /// Top up the $ORE pool. Anyone may: the team, ORE themselves, a sponsor, a player.
    /// The pool has no withdraw path, so what goes in can only leave as a payout.
    pub fn fund_ore(ctx: Context<FundOre>, amount: u64) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_ata.to_account_info(),
                    mint: ctx.accounts.ore_mint.to_account_info(),
                    to: ctx.accounts.ore_motherlode.to_account_info(),
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.ore_mint.decimals,
        )?;
        emit!(OreFunded {
            funder: ctx.accounts.funder.key(),
            amount,
            to_motherlode: true,
        });
        Ok(())
    }

    /// The authority's share of ORE gear sales. The pools have no withdraw path, same as SKR.
    pub fn withdraw_treasury_ore(ctx: Context<WithdrawTreasuryOre>, amount: u64) -> Result<()> {
        require!(
            amount > 0 && amount <= ctx.accounts.ore_treasury.amount,
            GaliError::BadAmount
        );
        let bump = ctx.accounts.config.bump;
        let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.ore_treasury.to_account_info(),
                    mint: ctx.accounts.ore_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.ore_mint.decimals,
        )?;
        emit!(TreasuryWithdrawn {
            to: ctx.accounts.destination.key(),
            amount
        });
        Ok(())
    }

    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount: u64) -> Result<()> {
        require!(
            amount > 0 && amount <= ctx.accounts.treasury.amount,
            GaliError::BadAmount
        );
        let bump = ctx.accounts.config.bump;
        let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.treasury.to_account_info(),
                    mint: ctx.accounts.skr_mint.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.skr_mint.decimals,
        )?;
        emit!(TreasuryWithdrawn {
            to: ctx.accounts.destination.key(),
            amount
        });
        Ok(())
    }

    /// Step 1 of handing over admin (and the SOL fee stream): name the new authority.
    /// Pass the default (all-zero) key to cancel.
    pub fn propose_authority(ctx: Context<AdminConfig>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = new_authority;
        emit!(AuthorityProposed {
            current: ctx.accounts.config.authority,
            proposed: new_authority
        });
        Ok(())
    }

    /// Step 2: the proposed authority signs to take over.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        let new = ctx.accounts.new_authority.key();
        require!(
            c.pending_authority != Pubkey::default() && c.pending_authority == new,
            GaliError::NotAuthorised
        );
        let old = c.authority;
        c.authority = new;
        c.pending_authority = Pubkey::default();
        emit!(AuthorityChanged { old, new });
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
    pub fn set_session(
        ctx: Context<SetSession>,
        session: Pubkey,
        expires_at: i64,
        fund_lamports: u64,
    ) -> Result<()> {
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
        emit!(SessionSet {
            owner: p.owner,
            session,
            expires_at
        });
        Ok(())
    }

    /// Credit a player for a round they played on ORE's board.
    ///
    /// Gali does not run the round any more, so this is how the game layer learns
    /// what happened: it reads ORE's own Round and Miner accounts and awards points,
    /// wins, streaks and XP from them. Nothing here can be asserted by the caller.
    /// Every number comes out of accounts owned by ORE's program.
    ///
    /// Permissionless on purpose. Anyone may crank it for anyone, the same way ORE
    /// lets anyone checkpoint a miner, so a player who closes the app still gets
    /// their points. It pays no crank fee, because it moves no value: the SKR
    /// motherlode bonus is claimed separately by the player who earned it.
    ///
    /// Call it after ORE has checkpointed the miner and before they deploy again,
    /// which is the window in which ORE's miner account still holds that round.
    pub fn record_ore_round(ctx: Context<RecordOreRound>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, GaliError::Paused);

        // Refuse the live round: its result is not fixed until ORE moves on.
        let current = ore::board_round_id(&ctx.accounts.ore_board)?;
        require!(round_id < current, GaliError::OreRoundStillLive);

        let player_key = ctx.accounts.player.owner;
        let round = ore::OreRound::load(&ctx.accounts.ore_round, round_id)?;
        let miner = ore::OreMiner::load(&ctx.accounts.ore_miner, &player_key, round_id)?;

        let p = &mut ctx.accounts.player;
        require!(round_id > p.last_ore_round, GaliError::OreRoundAlreadyRecorded);

        let square = round.winning_square.unwrap_or(0);
        let covered = miner.deployed.iter().filter(|v| **v > 0).count() as u64;
        require!(covered > 0, GaliError::NothingToClaim);
        let won = miner.deployed[square] > 0;

        // A boost has to predate the round it boosts. Without this, the same tokens
        // could be staked after a round finished, used to inflate its points, then
        // unstaked and handed to the next wallet to do it again.
        let boost = if p.stake_slot < round.end_slot() {
            boost_bps(cfg, p.staked_skr, p.staked_ore)
        } else {
            BPS as u16
        };
        let points = if won {
            let mut base = cfg.base_points.saturating_mul(BLOCKS as u64) / covered.max(1);
            if round.motherlode > 0 {
                base = base.saturating_add(cfg.motherlode_points);
            }
            base.saturating_mul(boost as u64) / BPS
        } else {
            0
        };

        // Day streak, on the chain's clock rather than the device's.
        let day = (Clock::get()?.unix_timestamp / 86_400) as u32;
        if day != p.day {
            p.streak = if day == p.day.saturating_add(1) {
                p.streak.saturating_add(1)
            } else {
                1
            };
            p.day = day;
        }

        p.last_ore_round = round_id;
        p.rounds = p.rounds.saturating_add(1);
        p.sol_deployed = p.sol_deployed.saturating_add(miner.total_deployed());
        if won {
            p.points = p.points.saturating_add(points);
            p.wins = p.wins.saturating_add(1);
            p.xp = p.xp.saturating_add(50);
        }

        emit!(OreRoundRecorded {
            owner: player_key,
            round_id,
            winning_square: square as u8,
            won,
            split: round.split,
            motherlode: round.motherlode > 0,
            covered: covered as u8,
            points,
        });
        Ok(())
    }

    /// Take this player's share of Gali's jackpot for an ORE round that hit ORE's
    /// motherlode.
    ///
    /// ORE pays its own motherlode in ORE, split across the winning square by each
    /// miner's slice of it. Gali pays both its pools on top of that same event, to
    /// the same people, in the same proportions. One hit, three assets in the
    /// wallet, and Gali mints none of them: the pools are what players put in
    /// buying gear.
    ///
    /// Both pools are paid in one call rather than two, so a winner cannot take the
    /// SKR and leave the ORE behind for someone else's share to grow into.
    ///
    /// Signed by the player, because it moves value to them. Everything it decides
    /// comes out of ORE-owned accounts.
    pub fn claim_jackpot(ctx: Context<ClaimJackpot>, round_id: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, GaliError::Paused);

        let current = ore::board_round_id(&ctx.accounts.ore_board)?;
        require!(round_id < current, GaliError::OreRoundStillLive);

        let owner = ctx.accounts.player.owner;
        let round = ore::OreRound::load(&ctx.accounts.ore_round, round_id)?;
        let miner = ore::OreMiner::load(&ctx.accounts.ore_miner, &owner, round_id)?;

        // Only rounds where ORE's own motherlode paid out carry a Gali jackpot.
        require!(round.motherlode > 0, GaliError::NothingToClaim);

        let bps = ore::winning_share_bps(&round, &miner);
        require!(bps > 0, GaliError::NotOnWinningSquare);

        {
            let p = &mut ctx.accounts.player;
            require!(round_id > p.jackpot_round, GaliError::OreRoundAlreadyRecorded);
            p.jackpot_round = round_id;
        }

        let skr_pool = ctx.accounts.motherlode.amount;
        let ore_pool = ctx.accounts.ore_motherlode.amount;
        let jackpot = &mut ctx.accounts.jackpot;
        if jackpot.bump == 0 {
            jackpot.bump = ctx.bumps.jackpot;
            jackpot.round_id = round_id;
            jackpot.skr_snapshot = skr_pool;
            jackpot.ore_snapshot = ore_pool;
        }
        require!(jackpot.round_id == round_id, GaliError::WrongRound);

        // Rounding always favours the pools, so the last claimer cannot overdraw them.
        let remaining_bps = BPS.saturating_sub(jackpot.bps_paid);
        let pay_bps = bps.min(remaining_bps);
        let share = |snapshot: u64, pool: u64| -> u64 {
            (((snapshot as u128 * pay_bps as u128) / BPS as u128) as u64).min(pool)
        };
        let skr = share(jackpot.skr_snapshot, skr_pool);
        let ore_amount = share(jackpot.ore_snapshot, ore_pool);
        require!(skr > 0 || ore_amount > 0, GaliError::NothingToClaim);
        jackpot.bps_paid = jackpot.bps_paid.saturating_add(pay_bps);

        let bump = ctx.accounts.config.bump;
        let cfg_signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        for (amount, from, mint, to, decimals) in [
            (
                skr,
                ctx.accounts.motherlode.to_account_info(),
                ctx.accounts.skr_mint.to_account_info(),
                ctx.accounts.owner_skr.to_account_info(),
                ctx.accounts.skr_mint.decimals,
            ),
            (
                ore_amount,
                ctx.accounts.ore_motherlode.to_account_info(),
                ctx.accounts.ore_mint.to_account_info(),
                ctx.accounts.owner_ore.to_account_info(),
                ctx.accounts.ore_mint.decimals,
            ),
        ] {
            if amount == 0 {
                continue;
            }
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from,
                        mint,
                        to,
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    cfg_signer,
                ),
                amount,
                decimals,
            )?;
        }

        let p = &mut ctx.accounts.player;
        p.skr_won = p.skr_won.saturating_add(skr);
        p.ore_mined = p.ore_mined.saturating_add(ore_amount);

        emit!(JackpotClaimed {
            owner,
            round_id,
            share_bps: pay_bps,
            skr,
            ore: ore_amount,
        });
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
        emit!(MotherlodeFunded {
            funder: ctx.accounts.funder.key(),
            amount
        });
        Ok(())
    }

    /// Buy a gear item with $ORE instead of SKR. Same items, same one-per-player rule,
    /// separate price list. The ORE splits into the ORE Motherlode and ORE Rewards Pools
    /// and the treasury, so ORE spent on cosmetics comes back to miners as mined ORE.
    pub fn buy_gear_ore(ctx: Context<BuyGearOre>, item: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, GaliError::Paused);
        require!((item as usize) < MAX_GEAR, GaliError::UnknownItem);
        fresh_prices(cfg)?;
        let usd = *cfg
            .gear_prices_usd
            .get(item as usize)
            .ok_or(GaliError::UnknownItem)?;
        require!(usd > 0, GaliError::UnknownItem);
        let decimals = ctx.accounts.ore_mint.decimals;
        let price = token_units(usd, cfg.ore_price_micro, decimals)?;
        require!(price > 0, GaliError::BadAmount);

        let p = &mut ctx.accounts.player;
        require!(p.gear_mask & (1u32 << item) == 0, GaliError::AlreadyOwned);

        let to_motherlode = price.saturating_mul(cfg.ore_motherlode_bps as u64) / BPS;
        let to_treasury = price - to_motherlode;
        for (amount, dest) in [
            (to_motherlode, ctx.accounts.ore_motherlode.to_account_info()),
            (to_treasury, ctx.accounts.ore_treasury.to_account_info()),
        ] {
            if amount == 0 {
                continue;
            }
            token_interface::transfer_checked(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.user_ata.to_account_info(),
                        mint: ctx.accounts.ore_mint.to_account_info(),
                        to: dest,
                        authority: ctx.accounts.owner.to_account_info(),
                    },
                ),
                amount,
                decimals,
            )?;
        }
        p.gear_mask |= 1u32 << item;
        emit!(GearBoughtOre {
            owner: p.owner,
            item,
            price
        });
        Ok(())
    }

    /// Stake $ORE in the Gali vault for a points boost. The better of the SKR and ORE
    /// boosts applies, so staking both does not stack.
    pub fn stake_ore(ctx: Context<StakeOre>, amount: u64) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.user_ata.to_account_info(),
                    mint: ctx.accounts.ore_mint.to_account_info(),
                    to: ctx.accounts.ore_vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.ore_mint.decimals,
        )?;
        let p = &mut ctx.accounts.player;
        p.staked_ore = p
            .staked_ore
            .checked_add(amount)
            .ok_or(GaliError::BadAmount)?;
        p.stake_slot = Clock::get()?.slot;
        emit!(StakedOre {
            owner: p.owner,
            amount,
            total: p.staked_ore
        });
        Ok(())
    }

    /// Take staked $ORE back. Locked for the round it is boosting, same rule as SKR,
    /// so the same ORE can't boost two wallets in one round.
    pub fn unstake_ore(ctx: Context<UnstakeOre>, amount: u64) -> Result<()> {
        let p = &mut ctx.accounts.player;
        require!(amount > 0 && amount <= p.staked_ore, GaliError::BadAmount);
        p.staked_ore -= amount;
        let bump = ctx.accounts.config.bump;
        let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.ore_vault.to_account_info(),
                    mint: ctx.accounts.ore_mint.to_account_info(),
                    to: ctx.accounts.user_ata.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.ore_mint.decimals,
        )?;
        emit!(StakedOre {
            owner: p.owner,
            amount: 0,
            total: p.staked_ore
        });
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
        p.staked_skr = p
            .staked_skr
            .checked_add(amount)
            .ok_or(GaliError::BadAmount)?;
        p.stake_slot = Clock::get()?.slot;
        emit!(Staked {
            owner: p.owner,
            amount,
            total: p.staked_skr
        });
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
        emit!(Staked {
            owner: p.owner,
            amount: 0,
            total: p.staked_skr
        });
        Ok(())
    }

    pub fn buy_gear(ctx: Context<BuyGear>, item: u8) -> Result<()> {
        let cfg = &ctx.accounts.config;
        require!(!cfg.paused, GaliError::Paused);
        require!((item as usize) < MAX_GEAR, GaliError::UnknownItem);
        fresh_prices(cfg)?;
        let usd = *cfg
            .gear_prices_usd
            .get(item as usize)
            .ok_or(GaliError::UnknownItem)?;
        require!(usd > 0, GaliError::UnknownItem);
        let decimals = ctx.accounts.skr_mint.decimals;
        let price = token_units(usd, cfg.skr_price_micro, decimals)?;
        require!(price > 0, GaliError::BadAmount);

        let p = &mut ctx.accounts.player;
        require!(p.gear_mask & (1u32 << item) == 0, GaliError::AlreadyOwned);

        // Most of a sale goes back into the jackpot players are chasing.
        let to_motherlode = price.saturating_mul(cfg.motherlode_pool_bps as u64) / BPS;
        let to_treasury = price - to_motherlode;
        for (amount, dest) in [
            (to_motherlode, ctx.accounts.motherlode.to_account_info()),
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
        p.gear_mask |= 1u32 << item;
        emit!(GearBought {
            owner: p.owner,
            item,
            price
        });
        Ok(())
    }
}

/// The better of the two staking boosts applies; they do not stack, so a player
/// can't multiply a round by staking both assets.
fn boost_bps(cfg: &Config, staked_skr: u64, staked_ore: u64) -> u16 {
    let tier = |t2: u64, t1: u64, staked: u64| -> u16 {
        if t2 > 0 && staked >= t2 {
            15_000
        } else if t1 > 0 && staked >= t1 {
            12_500
        } else {
            10_000
        }
    };
    tier(cfg.boost_tier2, cfg.boost_tier1, staked_skr).max(tier(
        cfg.ore_boost_tier2,
        cfg.ore_boost_tier1,
        staked_ore,
    ))
}

/* ---------------- accounts ---------------- */

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub skr_mint: Pubkey,
    pub ore_mint: Pubkey,
    /// set by `propose_authority`, cleared by `accept_authority`
    pub pending_authority: Pubkey,
    pub bump: u8,
    /// when true, gear sales and staking are refused
    pub paused: bool,

    /// points a recorded win is worth before the per-square and boost scaling
    pub base_points: u64,
    /// extra points when the round hit ORE's motherlode
    pub motherlode_points: u64,

    /// raw SKR staked for the 1.25x and 1.5x point boosts
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    /// raw ORE staked for the same tiers; the better of the two applies, they do not stack
    pub ore_boost_tier1: u64,
    pub ore_boost_tier2: u64,

    /// Gear is priced in millionths of a dollar, one entry per item id, so a move in
    /// either token does not silently reprice the shop.
    #[max_len(32)]
    pub gear_prices_usd: Vec<u64>,
    /// millionths of a dollar for one whole SKR, and for one whole ORE
    pub skr_price_micro: u64,
    pub ore_price_micro: u64,
    /// when the rates above were last set
    pub price_updated_at: i64,
    /// how stale a rate may be before gear sales are refused. 0 disables the check,
    /// which is only reasonable on a test validator.
    pub price_max_age_secs: u32,

    /// share of every SKR gear sale routed to the SKR jackpot, in bps; the rest is treasury
    pub motherlode_pool_bps: u16,
    /// the same for ORE gear sales. Kept separate because the two assets are not
    /// interchangeable to us: one is the jackpot players chase, the other is what
    /// the platform can actually spend.
    pub ore_motherlode_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ConfigUpdate {
    pub base_points: Option<u64>,
    pub motherlode_points: Option<u64>,
    pub boost_tier1: Option<u64>,
    pub boost_tier2: Option<u64>,
    pub ore_boost_tier1: Option<u64>,
    pub ore_boost_tier2: Option<u64>,
    pub gear_prices_usd: Option<Vec<u64>>,
    pub price_max_age_secs: Option<u32>,
    pub motherlode_pool_bps: Option<u16>,
    pub ore_motherlode_bps: Option<u16>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigArgs {
    pub base_points: u64,
    pub motherlode_points: u64,
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    pub ore_boost_tier1: u64,
    pub ore_boost_tier2: u64,
    pub gear_prices_usd: Vec<u64>,
    pub skr_price_micro: u64,
    pub ore_price_micro: u64,
    pub price_max_age_secs: u32,
    pub motherlode_pool_bps: u16,
    pub ore_motherlode_bps: u16,
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
    /// raw ORE staked in the Gali vault; boosts points like staked SKR
    pub staked_ore: u64,
    /// lifetime raw ORE mined from rounds
    pub ore_mined: u64,
    /// highest ORE round already recorded by `record_ore_round`, so a round pays points once.
    /// Reads as 0 on accounts created before the ORE board move, which is the correct start.
    pub last_ore_round: u64,
    /// highest ORE round whose SKR jackpot this player has taken, so it pays once
    pub jackpot_round: u64,
    /// slot at which staked SKR or ORE last went up. A round only pays the boost if
    /// the stake predates that round, so the same tokens cannot be staked, used to
    /// boost a finished round, unstaked and passed straight to the next wallet.
    pub stake_slot: u64,
    pub reserved: [u8; 24],
}

/// One per ORE round in which ORE's motherlode hit: Gali's jackpot for that round.
///
/// The snapshots are the point. Winners claim over minutes, and both pools keep
/// growing from gear sales the whole time. Paying a share of the live balance would
/// hand the first claimer more than the last for the same slice of the square. The
/// first claim freezes the numbers everyone is then paid out of.
#[account]
#[derive(InitSpace)]
pub struct Jackpot {
    pub round_id: u64,
    /// raw SKR and raw ORE in the pools when the first winner claimed
    pub skr_snapshot: u64,
    pub ore_snapshot: u64,
    /// basis points of the winning square already paid; never exceeds 10,000
    pub bps_paid: u64,
    pub bump: u8,
    pub reserved: [u8; 32],
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// Only the program's upgrade authority can create the config (no front-running after deploy).
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ GaliError::NotUpgradeAuthority)]
    pub program: Program<'info, crate::program::Gali>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ GaliError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Config>>,
    /// Only a plain SPL mint: Token-2022 extensions (transfer fees, hooks, permanent delegate)
    /// would break the escrow's accounting.
    #[account(constraint = *skr_mint.to_account_info().owner == anchor_spl::token::ID @ GaliError::BadConfig)]
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
    /// $ORE, the second asset. Same rule as SKR: a plain SPL mint only.
    #[account(constraint = *ore_mint.to_account_info().owner == anchor_spl::token::ID @ GaliError::BadConfig)]
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init, payer = authority, seeds = [b"ore_vault"], bump,
        token::mint = ore_mint, token::authority = config, token::token_program = token_program
    )]
    pub ore_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"ore_treasury"], bump,
        token::mint = ore_mint, token::authority = config, token::token_program = token_program
    )]
    pub ore_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"ore_motherlode"], bump,
        token::mint = ore_mint, token::authority = config, token::token_program = token_program
    )]
    pub ore_motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub new_authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct FundOre<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = ore_mint)]
    pub config: Box<Account<'info, Config>>,
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = ore_mint, token::authority = funder, token::token_program = token_program)]
    pub funder_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"ore_motherlode"], bump)]
    pub ore_motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawTreasuryOre<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority, has_one = ore_mint)]
    pub config: Box<Account<'info, Config>>,
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"ore_treasury"], bump)]
    pub ore_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = ore_mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"treasury"], bump)]
    pub treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = skr_mint, token::token_program = token_program)]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
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
pub struct BuyGearOre<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = ore_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub ore_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = ore_mint, token::authority = owner, token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"ore_treasury"], bump)]
    pub ore_treasury: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"ore_motherlode"], bump)]
    pub ore_motherlode: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimJackpot<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump,
        constraint = player.owner == owner.key() @ GaliError::NotAuthorised)]
    pub player: Box<Account<'info, Player>>,
    #[account(
        init_if_needed, payer = owner,
        seeds = [b"jackpot", round_id.to_le_bytes().as_ref()], bump,
        space = 8 + Jackpot::INIT_SPACE
    )]
    pub jackpot: Box<Account<'info, Jackpot>>,
    #[account(address = config.skr_mint @ GaliError::BadConfig)]
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = config.ore_mint @ GaliError::BadConfig)]
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"motherlode"], bump)]
    pub motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"ore_motherlode"], bump)]
    pub ore_motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = skr_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_skr: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, token::mint = ore_mint, token::authority = owner, token::token_program = token_program)]
    pub owner_ore: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: validated as an ORE-owned account of the right size and address.
    pub ore_board: UncheckedAccount<'info>,
    /// CHECK: validated as an ORE-owned account of the right size and derivation.
    pub ore_round: UncheckedAccount<'info>,
    /// CHECK: validated as an ORE-owned account of the right size and derivation.
    pub ore_miner: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RecordOreRound<'info> {
    /// Anyone. Cranking for another player is allowed and moves no value.
    #[account(mut)]
    pub cranker: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", player.owner.as_ref()], bump = player.bump)]
    pub player: Account<'info, Player>,
    /// ORE's board, checked by address and owner inside `ore::board_round_id`.
    /// CHECK: validated as an ORE-owned account of the right size and address.
    pub ore_board: UncheckedAccount<'info>,
    /// ORE's round account for `round_id`, checked by PDA and owner inside `OreRound::load`.
    /// CHECK: validated as an ORE-owned account of the right size and derivation.
    pub ore_round: UncheckedAccount<'info>,
    /// The player's ORE miner account, checked by PDA and owner inside `OreMiner::load`.
    /// CHECK: validated as an ORE-owned account of the right size and derivation.
    pub ore_miner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct StakeOre<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = ore_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub ore_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = ore_mint, token::authority = owner, token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"ore_vault"], bump)]
    pub ore_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct UnstakeOre<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = ore_mint)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Account<'info, Player>,
    pub ore_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed, payer = owner,
        associated_token::mint = ore_mint, associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"ore_vault"], bump)]
    pub ore_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
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
#[instruction(round_id: u64)]
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
pub struct TokenPricesSet {
    pub skr_price_micro: u64,
    pub ore_price_micro: u64,
    pub at: i64,
}

#[event]
pub struct ConfigUpdated {
    pub authority: Pubkey,
}

#[event]
pub struct PausedSet {
    pub paused: bool,
}

#[event]
pub struct TreasuryWithdrawn {
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AuthorityProposed {
    pub current: Pubkey,
    pub proposed: Pubkey,
}

#[event]
pub struct AuthorityChanged {
    pub old: Pubkey,
    pub new: Pubkey,
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

#[event]
pub struct OreFunded {
    pub funder: Pubkey,
    pub amount: u64,
    pub to_motherlode: bool,
}

#[event]
pub struct GearBoughtOre {
    pub owner: Pubkey,
    pub item: u8,
    pub price: u64,
}

#[event]
pub struct JackpotClaimed {
    pub owner: Pubkey,
    pub round_id: u64,
    pub share_bps: u64,
    pub skr: u64,
    pub ore: u64,
}

#[event]
pub struct OreRoundRecorded {
    pub owner: Pubkey,
    pub round_id: u64,
    pub winning_square: u8,
    pub won: bool,
    pub split: bool,
    pub motherlode: bool,
    pub covered: u8,
    pub points: u64,
}

#[event]
pub struct StakedOre {
    pub owner: Pubkey,
    pub amount: u64,
    pub total: u64,
}

#[error_code]
pub enum GaliError {
    #[msg("Invalid config")]
    BadConfig,
    #[msg("That round isn't open")]
    WrongRound,
    #[msg("This round is locked; wait for the next one")]
    RoundLocked,
    #[msg("Pick between 1 and 25 spots")]
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
    #[msg("Gali is paused for maintenance")]
    Paused,
    #[msg("You already have SOL on that spot this round")]
    AlreadyOnBlock,
    #[msg("This round's draw is already locked")]
    AlreadyLocked,
    #[msg("Lock the round before revealing it")]
    NotLocked,
    #[msg("The locked slot has expired; lock the round again")]
    DrawExpired,
    #[msg("This round is already revealed")]
    AlreadyRevealed,
    #[msg("Your staked SKR is boosting this round; unstake after it ends")]
    StakeInPlay,
    #[msg("Only the program's upgrade authority can do this")]
    NotUpgradeAuthority,
    #[msg("Nothing to claim yet")]
    NothingToClaim,
    #[msg("Too early to close this round")]
    TooEarly,
    #[msg("Some stakes in this round are not claimed yet")]
    UnclaimedStakes,
    #[msg("This round was abandoned and refunded")]
    RoundAbandoned,
    #[msg("That is not the ORE account it claims to be")]
    BadOreAccount,
    #[msg("ORE's account layout has changed; Gali needs updating before it can read it")]
    BadOreLayout,
    #[msg("That ORE round has not been drawn yet")]
    OreRoundUnsettled,
    #[msg("Your ORE miner account is on a different round")]
    OreRoundMismatch,
    #[msg("Checkpoint your ORE miner for this round first")]
    OreNotCheckpointed,
    #[msg("This ORE round is already recorded")]
    OreRoundAlreadyRecorded,
    #[msg("That ORE round is still live")]
    OreRoundStillLive,
    #[msg("You were not on the winning square")]
    NotOnWinningSquare,
    #[msg("No exchange rate is set for that token")]
    PriceUnset,
    #[msg("The exchange rate is stale; gear sales are paused until it is refreshed")]
    PriceStale,
}
