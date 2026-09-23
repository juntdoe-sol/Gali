//! Gali: a mining game for Solana Seeker.
//!
//! * Rounds are derived from the clock: `round_id = unix_ts / round_secs`. No crank needed to open a round.
//! * Players `deploy` SOL on 1 to 25 spots of the current round (from their wallet or a session key).
//! * After a round ends, anyone can `lock_round` (fixes a future slot) and, a couple of slots later,
//!   `reveal_round`, which derives the winning spot and the 1-in-625 motherlode from that slot's hash.
//! * Winners take the losers' SOL. Each spot pays a 1% admin fee, and every losing spot also pays
//!   `pot_fee_bps` (10%) of the rest. The miners on the winning spot then split everything that is
//!   left (their own SOL plus the losing spots' SOL), pro rata to their SOL on that spot. Miners on
//!   losing spots get no SOL back. Covering all 25 spots on your own only gets your SOL back minus fees.
//!   If nobody is on the winning spot, everything after the admin fee counts as protocol fee.
//! * SKR per round (`round_reward_skr`) goes to the winning spot. Each round, 10 of the 25 spots are
//!   "solo spots" (fixed in advance from the round id, see `solo_mask`): if one of them wins, one miner
//!   takes the whole reward, drawn with odds equal to their share of that spot. Otherwise it is split.
//!   To keep the draw exact, a player can deploy on each spot once per round.
//! * Motherlode: every settled round adds `motherlode_skr` from the Rewards Pool to the Motherlode Pool
//!   (gear sales add more). On a hit, the whole pool, as it stands before that round's top-up, is split
//!   pro rata between the miners on the winning spot. An early hit pays less.
//! * Budget: the SKR paid each round is capped by what the Rewards Pool can sustain. With
//!   `reward_drip_bps` set, a round pays at most `reward_drip_bps` of the pool's balance (split between
//!   the round reward and the Motherlode top-up in the ratio of their caps), so payouts follow what
//!   flows in: gear sales plus SKR bought back with `buyback_bps` of the SOL fees. `buyback_due`
//!   tracks the SOL owed to buybacks; the admin swaps it for SKR, funds the pool and calls `mark_buyback`.
//! * `claim_pot` credits each stake's SOL and mined ("unrefined") SKR to the player's `Unclaimed`
//!   balance (plus points scaled by 25 / spots covered, boosted by staked SKR). `claim_rewards` pays
//!   it out: SOL in full; unrefined SKR less a 10% refining fee, which is shared pro rata between
//!   everyone still holding unrefined SKR as "refined" SKR (claimed without a fee). Holding pays.
//! * SKR can't be minted by the game: gear sales (bought with SKR) and top-ups fill the Motherlode
//!   and Rewards Pools.
//!
//! * Admin (config authority): `update_config` (with hard caps), `set_paused` (stops new deploys and
//!   gear sales; reveals, settlements, claims and unstaking keep working), `withdraw_treasury`
//!   (treasury SKR only; the pools and staked SKR can't be withdrawn), and a two-step authority
//!   hand-over (`propose_authority` + `accept_authority`).
//!
//! Randomness: `lock_round` commits to a slot that doesn't exist yet; `reveal_round` must use the hash
//! of the first slot at or after it, so the result can't be re-rolled by retrying or reverting the
//! reveal. The leader of that slot can still influence it: replace with a VRF before mainnet use.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{hash::hashv, sysvar::slot_hashes};
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
pub const FACTOR_SCALE: u128 = 1_000_000_000_000;
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
pub const CRANK_FEE: u64 = 20_000;
pub const CLAIM_SOL: u8 = 1;
pub const CLAIM_SKR: u8 = 2;
pub const CLAIM_ORE: u8 = 4;
/// Taken from every spot, win or lose (sent to the treasury wallet).
pub const ADMIN_FEE_BPS: u64 = 100;
/// Spots per round where the winner takes the whole SKR reward.
pub const SOLO_SPOTS: usize = 10;
/// `lock_round` targets the slot this many slots ahead.
pub const DRAW_DELAY_SLOTS: u64 = 5;
/// A lock can only be replaced once its slot has fallen out of SlotHashes, so a losing player can't
/// withhold the reveal and re-roll: by then nobody could have revealed it either.
pub const DRAW_EXPIRY_SLOTS: u64 = SLOT_HASH_WINDOW;

/// The round's solo spots as a bitmask: a Fisher-Yates pick of 10 of 25, seeded by sha256("gali-solo" || round_id).
/// Known before the round starts, so players can choose.
pub fn solo_mask(round_id: u64) -> u32 {
    let seed = hashv(&[b"gali-solo", &round_id.to_le_bytes()]).to_bytes();
    let mut idx = [0u8; BLOCKS as usize];
    for (i, v) in idx.iter_mut().enumerate() {
        *v = i as u8;
    }
    let mut mask = 0u32;
    for i in 0..SOLO_SPOTS {
        let r = u16::from_le_bytes([seed[2 * i], seed[2 * i + 1]]) as usize;
        let j = i + r % (BLOCKS as usize - i);
        idx.swap(i, j);
        mask |= 1 << idx[i];
    }
    mask
}

/// (admin fee, protocol fee if the spot loses) for `d` lamports on a spot.
pub fn spot_fees(d: u64, fee_bps: u16) -> (u64, u64) {
    let admin = (d as u128 * ADMIN_FEE_BPS as u128 / BPS as u128) as u64;
    let prot = ((d - admin) as u128 * fee_bps as u128 / BPS as u128) as u64;
    (admin, prot)
}

/// Adds the refined SKR this balance has earned since it last synced with the refinery.
fn sync_refined(u: &mut Unclaimed, rf: &Refinery) -> Result<()> {
    if rf.factor > u.factor {
        let gain = (rf.factor - u.factor)
            .checked_mul(u.skr as u128)
            .ok_or(GaliError::BadAmount)?
            / FACTOR_SCALE;
        u.refined = u.refined.saturating_add(u64::try_from(gain).map_err(|_| GaliError::BadAmount)?);
    }
    u.factor = rf.factor;
    Ok(())
}

/// End of a round as a unix timestamp, rejecting round ids that can't exist.
fn round_end_ts(round_id: u64, round_secs: u32) -> Result<i64> {
    let secs = round_secs as i64;
    let end = (round_id as i128 + 1) * secs as i128;
    require!(end <= i64::MAX as i128, GaliError::WrongRound);
    Ok(end as i64)
}

fn check_config(cfg: &Config) -> Result<()> {
    require!(cfg.round_secs >= 15, GaliError::BadConfig);
    require!(cfg.gear_prices.len() <= MAX_GEAR, GaliError::BadConfig);
    require!(cfg.pot_fee_bps <= MAX_POT_FEE_BPS, GaliError::BadConfig);
    require!(
        cfg.motherlode_pool_bps as u64 + cfg.rewards_pool_bps as u64 <= BPS,
        GaliError::BadConfig
    );
    require!(cfg.min_deploy > 0, GaliError::BadConfig);
    // the drip is what bounds a round's SKR payout to a slice of the pool, so it can't be switched off
    require!(
        cfg.reward_drip_bps >= 1 && cfg.reward_drip_bps <= MAX_DRIP_BPS,
        GaliError::BadConfig
    );
    require!(cfg.buyback_bps as u64 <= BPS, GaliError::BadConfig);
    require!(
        cfg.boost_tier2 == 0 || cfg.boost_tier2 >= cfg.boost_tier1,
        GaliError::BadConfig
    );
    // $ORE: same shape of limits as SKR
    require!(cfg.gear_prices_ore.len() <= MAX_GEAR, GaliError::BadConfig);
    require!(
        cfg.ore_motherlode_bps as u64 + cfg.ore_rewards_bps as u64 <= BPS,
        GaliError::BadConfig
    );
    require!(
        cfg.ore_drip_bps >= 1 && cfg.ore_drip_bps <= MAX_DRIP_BPS,
        GaliError::BadConfig
    );
    require!(
        cfg.ore_boost_tier2 == 0 || cfg.ore_boost_tier2 >= cfg.ore_boost_tier1,
        GaliError::BadConfig
    );
    Ok(())
}

#[program]
pub mod gali {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, args: ConfigArgs) -> Result<()> {
        require!(args.gear_prices.len() <= MAX_GEAR, GaliError::BadConfig);
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
        c.reward_drip_bps = args.reward_drip_bps;
        c.buyback_bps = args.buyback_bps;
        c.buyback_due = 0;
        c.ore_mint = ctx.accounts.ore_mint.key();
        c.gear_prices_ore = args.gear_prices_ore;
        c.ore_motherlode_bps = args.ore_motherlode_bps;
        c.ore_rewards_bps = args.ore_rewards_bps;
        c.ore_boost_tier1 = args.ore_boost_tier1;
        c.ore_boost_tier2 = args.ore_boost_tier2;
        c.round_reward_ore = args.round_reward_ore;
        c.motherlode_ore = args.motherlode_ore;
        c.ore_drip_bps = args.ore_drip_bps;
        c.paused = false;
        c.pending_authority = Pubkey::default();
        c.bump = ctx.bumps.config;
        ctx.accounts.buyback.bump = ctx.bumps.buyback;
        check_config(c)
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
        if let Some(v) = u.gear_prices {
            require!(v.len() <= MAX_GEAR, GaliError::BadConfig);
            c.gear_prices = v;
        }
        if let Some(v) = u.motherlode_skr {
            c.motherlode_skr = v;
        }
        if let Some(v) = u.motherlode_pool_bps {
            c.motherlode_pool_bps = v;
        }
        if let Some(v) = u.rewards_pool_bps {
            c.rewards_pool_bps = v;
        }
        if let Some(v) = u.pot_fee_bps {
            c.pot_fee_bps = v;
        }
        if let Some(v) = u.min_deploy {
            c.min_deploy = v;
        }
        if let Some(v) = u.round_reward_skr {
            c.round_reward_skr = v;
        }
        if let Some(v) = u.reward_drip_bps {
            c.reward_drip_bps = v;
        }
        if let Some(v) = u.buyback_bps {
            c.buyback_bps = v;
        }
        if let Some(v) = u.gear_prices_ore {
            require!(v.len() <= MAX_GEAR, GaliError::BadConfig);
            c.gear_prices_ore = v;
        }
        if let Some(v) = u.ore_motherlode_bps {
            c.ore_motherlode_bps = v;
        }
        if let Some(v) = u.ore_rewards_bps {
            c.ore_rewards_bps = v;
        }
        if let Some(v) = u.ore_boost_tier1 {
            c.ore_boost_tier1 = v;
        }
        if let Some(v) = u.ore_boost_tier2 {
            c.ore_boost_tier2 = v;
        }
        if let Some(v) = u.round_reward_ore {
            c.round_reward_ore = v;
        }
        if let Some(v) = u.motherlode_ore {
            c.motherlode_ore = v;
        }
        if let Some(v) = u.ore_drip_bps {
            c.ore_drip_bps = v;
        }
        check_config(c)?;
        emit!(ConfigUpdated {
            authority: c.authority
        });
        Ok(())
    }

    /// Take SOL out of the buyback escrow to buy SKR for the Rewards Pool. Only the authority, and
    /// only what the escrow holds above its rent; `buyback_due` drops by the same amount.
    pub fn mark_buyback(ctx: Context<MarkBuyback>, lamports: u64) -> Result<()> {
        let info = ctx.accounts.buyback.to_account_info();
        let free = info
            .lamports()
            .saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        require!(lamports > 0 && lamports <= free, GaliError::BadAmount);
        **info.try_borrow_mut_lamports()? -= lamports;
        **ctx.accounts.destination.to_account_info().try_borrow_mut_lamports()? += lamports;
        let c = &mut ctx.accounts.config;
        c.buyback_due = c.buyback_due.saturating_sub(lamports);
        emit!(BuybackMarked {
            lamports,
            due: c.buyback_due
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
    /// The Motherlode Pool, Rewards Pool, pot escrow and staking vault have no withdraw path.
    /// Anyone can top up the $ORE pools: the team, ORE themselves, a sponsor, a player.
    /// `to_motherlode` picks which pool; false means the Rewards Pool that rounds mine from.
    pub fn fund_ore(ctx: Context<FundOre>, amount: u64, to_motherlode: bool) -> Result<()> {
        require!(amount > 0, GaliError::BadAmount);
        let dest = if to_motherlode {
            ctx.accounts.ore_motherlode.to_account_info()
        } else {
            ctx.accounts.ore_rewards.to_account_info()
        };
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.funder_ata.to_account_info(),
                    mint: ctx.accounts.ore_mint.to_account_info(),
                    to: dest,
                    authority: ctx.accounts.funder.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.ore_mint.decimals,
        )?;
        emit!(OreFunded {
            funder: ctx.accounts.funder.key(),
            amount,
            to_motherlode
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

    /// Put `lamports_per_block` SOL on every block in `mask` for the current round.
    /// Signed by the owner or their active session key (the SOL comes from the signer).
    pub fn deploy(
        ctx: Context<Deploy>,
        round_id: u64,
        mask: u32,
        lamports_per_block: u64,
    ) -> Result<()> {
        let signer = ctx.accounts.signer.key();
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        {
            let p = &ctx.accounts.player;
            let is_owner = signer == p.owner;
            let is_session =
                signer == p.session && p.session != Pubkey::default() && now < p.session_expires;
            require!(is_owner || is_session, GaliError::NotAuthorised);
        }
        require!(!cfg.paused, GaliError::Paused);
        let current = (now / cfg.round_secs as i64) as u64;
        require!(round_id == current, GaliError::WrongRound);
        require!(
            (current as i64 + 1) * cfg.round_secs as i64 - now > LOCK_SECS,
            GaliError::RoundLocked
        );
        require!(
            mask != 0 && mask & !ALL_BLOCKS_MASK == 0,
            GaliError::BadMask
        );
        require!(
            lamports_per_block >= cfg.min_deploy.max(1),
            GaliError::BadAmount
        );
        let total = lamports_per_block
            .checked_mul(mask.count_ones() as u64)
            .ok_or(GaliError::BadAmount)?;

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
            pot.rent_payer = signer;
            // the round's terms are fixed by its first deploy, so later config changes can't rewrite them
            pot.fee_bps = cfg.pot_fee_bps;
            pot.base_points = cfg.base_points;
            pot.motherlode_points = cfg.motherlode_points;
        }
        let boost = boost_bps(
            cfg,
            ctx.accounts.player.staked_skr,
            ctx.accounts.player.staked_ore,
        );
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
        let crank_fee = if first_in_round { CRANK_FEE } else { 0 };
        for i in 0..BLOCKS as usize {
            if mask & (1 << i) != 0 {
                // one deposit per block per round, so each stake owns one contiguous
                // lamport range [start, start + amount) for the lucky-winner draw
                require!(st.per_block[i] == 0, GaliError::AlreadyOnBlock);
                st.start[i] = pot.per_block[i];
                st.per_block[i] = lamports_per_block;
                pot.per_block[i] = pot.per_block[i]
                    .checked_add(lamports_per_block)
                    .ok_or(GaliError::BadAmount)?;
            }
        }
        pot.total = pot.total.checked_add(total).ok_or(GaliError::BadAmount)?;
        if crank_fee > 0 {
            // pays whoever claims this stake later, so cranking for other players isn't a loss
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.signer.to_account_info(),
                        to: ctx.accounts.stake.to_account_info(),
                    },
                ),
                crank_fee,
            )?;
        }
        let p = &mut ctx.accounts.player;
        p.sol_deployed = p.sol_deployed.saturating_add(total);
        if first_in_round {
            let today = (now / SECONDS_PER_DAY) as u32;
            if p.day != today {
                p.streak = if p.day + 1 == today {
                    p.streak.saturating_add(1)
                } else {
                    1
                };
                p.day = today;
            }
            p.rounds = p.rounds.saturating_add(1);
            p.xp = p.xp.saturating_add(10 + mask.count_ones() as u64);
        }
        emit!(Deployed {
            owner,
            round_id,
            mask,
            lamports_per_block,
            pot_total: pot.total
        });
        Ok(())
    }

    /// Permissionless, once per revealed round: sends the fees to the treasury wallet, escrows the round's
    /// SKR (plus the whole Motherlode Pool on a hit), then tops the Motherlode Pool up for the next rounds.
    pub fn settle_pot(ctx: Context<SettlePot>, _round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let r = &ctx.accounts.round;
        let win = r.winning_block as usize;
        require!(!ctx.accounts.pot.settled, GaliError::AlreadySettled);
        require!(ctx.accounts.pot.refunded == 0, GaliError::RoundAbandoned);
        let has_winners = ctx.accounts.pot.per_block[win] > 0;
        // fixed when the round opened, so a config change after the fact can't move the fee
        let fee_bps = ctx.accounts.pot.fee_bps;

        let total = ctx.accounts.pot.total;
        let (mut admin_fee, mut protocol_fee) = (0u64, 0u64);
        for (i, d) in ctx.accounts.pot.per_block.iter().enumerate() {
            let (a, p) = spot_fees(*d, fee_bps);
            admin_fee += a;
            if i != win {
                protocol_fee += p;
            }
        }
        if !has_winners {
            // nobody to pay: everything after the admin fee goes to the protocol
            protocol_fee = total - admin_fee;
        }
        let fee = admin_fee + protocol_fee;
        // the buyback share is held by the program until the admin withdraws it to buy SKR
        let owed = (fee as u128 * cfg.buyback_bps as u128 / BPS as u128) as u64;
        if fee > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_to.to_account_info().try_borrow_mut_lamports()? += fee - owed;
            **ctx.accounts.buyback.to_account_info().try_borrow_mut_lamports()? += owed;
        }

        let bump = cfg.bump;
        let signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        let decimals = ctx.accounts.skr_mint.decimals;
        let rewards_bal = ctx.accounts.rewards.amount;
        // this round's SKR budget: the caps, limited to a slice of the Rewards Pool when the drip is on
        let cap = cfg.round_reward_skr.saturating_add(cfg.motherlode_skr);
        let budget = if cfg.reward_drip_bps > 0 {
            cap.min((rewards_bal as u128 * cfg.reward_drip_bps as u128 / BPS as u128) as u64)
        } else {
            cap
        };
        let (reward_part, accrual_part) = if cap == 0 {
            (0, 0)
        } else {
            let r = (budget as u128 * cfg.round_reward_skr as u128 / cap as u128) as u64;
            (r, budget - r)
        };
        // SKR mined this round, and the whole Motherlode Pool on a hit (only if someone is on the winning spot)
        let from_rewards = if has_winners {
            reward_part.min(rewards_bal)
        } else {
            0
        };
        let from_motherlode = if has_winners && r.motherlode {
            ctx.accounts.motherlode.amount
        } else {
            0
        };
        // then this round's top-up of the Motherlode Pool (after the payout, so it goes to future rounds)
        let accrual = accrual_part.min(rewards_bal - from_rewards);
        for (amount, src, dst) in [
            (from_rewards, ctx.accounts.rewards.to_account_info(), ctx.accounts.pot_vault.to_account_info()),
            (from_motherlode, ctx.accounts.motherlode.to_account_info(), ctx.accounts.pot_vault.to_account_info()),
            (accrual, ctx.accounts.rewards.to_account_info(), ctx.accounts.motherlode.to_account_info()),
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
                        to: dst,
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                amount,
                decimals,
            )?;
        }

        // $ORE: the same drip, cap and split, from the ORE pools. The ORE Rewards Pool is
        // filled by players buying gear with ORE, so it pays what has flowed in and no more.
        let ore_decimals = ctx.accounts.ore_mint.decimals;
        let ore_bal = ctx.accounts.ore_rewards.amount;
        let ore_cap = cfg.round_reward_ore.saturating_add(cfg.motherlode_ore);
        let ore_budget = if cfg.ore_drip_bps > 0 {
            ore_cap.min((ore_bal as u128 * cfg.ore_drip_bps as u128 / BPS as u128) as u64)
        } else {
            ore_cap
        };
        let (ore_reward_part, ore_accrual_part) = if ore_cap == 0 {
            (0, 0)
        } else {
            let x = (ore_budget as u128 * cfg.round_reward_ore as u128 / ore_cap as u128) as u64;
            (x, ore_budget - x)
        };
        let ore_from_rewards = if has_winners {
            ore_reward_part.min(ore_bal)
        } else {
            0
        };
        let ore_from_motherlode = if has_winners && r.motherlode {
            ctx.accounts.ore_motherlode.amount
        } else {
            0
        };
        let ore_accrual = ore_accrual_part.min(ore_bal - ore_from_rewards);
        for (amount, src, dst) in [
            (ore_from_rewards, ctx.accounts.ore_rewards.to_account_info(), ctx.accounts.ore_pot_vault.to_account_info()),
            (ore_from_motherlode, ctx.accounts.ore_motherlode.to_account_info(), ctx.accounts.ore_pot_vault.to_account_info()),
            (ore_accrual, ctx.accounts.ore_rewards.to_account_info(), ctx.accounts.ore_motherlode.to_account_info()),
        ] {
            if amount == 0 {
                continue;
            }
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: src,
                        mint: ctx.accounts.ore_mint.to_account_info(),
                        to: dst,
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                amount,
                ore_decimals,
            )?;
        }

        ctx.accounts.config.buyback_due = ctx.accounts.config.buyback_due.saturating_add(owed);
        let pot = &mut ctx.accounts.pot;
        pot.ore_reward = ore_from_rewards;
        pot.motherlode_ore = ore_from_motherlode;
        pot.pool = total - fee;
        pot.admin_fee = admin_fee;
        pot.protocol_fee = protocol_fee;
        pot.skr_reward = from_rewards;
        pot.motherlode_skr = from_motherlode;
        pot.motherlode = r.motherlode && has_winners;
        pot.split_reward = r.split_reward;
        // the lamport on the winning spot that takes the reward on a solo spot
        pot.lucky_index = if has_winners {
            r.lucky % pot.per_block[win]
        } else {
            0
        };
        pot.settled = true;
        emit!(PotSettled {
            round_id: pot.round_id,
            winning_block: win as u8,
            total,
            fee,
            pool: pot.pool,
            skr_reward: from_rewards,
            motherlode_skr: from_motherlode,
            motherlode_accrued: accrual,
        });
        Ok(())
    }

    /// Permissionless: credits a stake's returned SOL and its SKR to the owner's Unclaimed balance, then closes it.
    pub fn claim_pot(ctx: Context<ClaimPot>, _round_id: u64) -> Result<()> {
        let win = ctx.accounts.round.winning_block as usize;
        require!(ctx.accounts.pot.settled, GaliError::NotSettled);
        let pot = &ctx.accounts.pot;
        let stake = &ctx.accounts.stake;
        let mine = stake.per_block[win] as u128;
        let on_win = pot.per_block[win] as u128;
        let won = mine > 0 && on_win > 0;
        // winners split the pool (everything after fees) by their SOL on the winning spot; losers get nothing
        let sol = if won {
            (mine * pot.pool as u128 / on_win) as u64
        } else {
            0
        };
        // the Motherlode is always split pro rata; the round's SKR is split, or all to one miner on a solo spot
        let from_motherlode = if won {
            (mine * pot.motherlode_skr as u128 / on_win) as u64
        } else {
            0
        };
        let (mined, lucky) = if !won {
            (0, false)
        } else if pot.split_reward {
            ((mine * pot.skr_reward as u128 / on_win) as u64, false)
        } else {
            let start = stake.start[win] as u128;
            let li = pot.lucky_index as u128;
            if li >= start && li < start + mine {
                (pot.skr_reward, true)
            } else {
                (0, false)
            }
        };
        let skr = mined + from_motherlode;
        // $ORE follows the same split. On a solo round the same miner takes both assets.
        let ore_from_motherlode = if won {
            (mine * pot.motherlode_ore as u128 / on_win) as u64
        } else {
            0
        };
        let ore_mined = if !won {
            0
        } else if pot.split_reward {
            (mine * pot.ore_reward as u128 / on_win) as u64
        } else if lucky {
            pot.ore_reward
        } else {
            0
        };
        let ore = ore_mined + ore_from_motherlode;
        let points = if won {
            let covered = stake.per_block.iter().filter(|v| **v > 0).count() as u64;
            let mut base = pot.base_points.saturating_mul(BLOCKS as u64) / covered.max(1);
            if pot.motherlode {
                base = base.saturating_add(pot.motherlode_points);
            }
            base.saturating_mul(stake.boost_bps as u64) / BPS
        } else {
            0
        };
        let round_id = pot.round_id;
        let owner = stake.owner;
        if sol > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= sol;
            **ctx.accounts.unclaimed.to_account_info().try_borrow_mut_lamports()? += sol;
        }
        {
            let pot = &mut ctx.accounts.pot;
            pot.claimed = pot.claimed.saturating_add(1);
            if won {
                pot.winners_paid = pot.winners_paid.saturating_add(1);
            }
            if lucky {
                pot.winner = owner;
            }
        }
        // the crank fee this stake carries pays whoever claimed it
        let fee_lamports = CRANK_FEE.min(
            ctx.accounts
                .stake
                .to_account_info()
                .lamports()
                .saturating_sub(Rent::get()?.minimum_balance(8 + Stake::INIT_SPACE)),
        );
        if fee_lamports > 0 {
            **ctx.accounts.stake.to_account_info().try_borrow_mut_lamports()? -= fee_lamports;
            **ctx.accounts.cranker.to_account_info().try_borrow_mut_lamports()? += fee_lamports;
        }
        let rf = &mut ctx.accounts.refinery;
        if rf.bump == 0 {
            rf.bump = ctx.bumps.refinery;
        }
        let u = &mut ctx.accounts.unclaimed;
        if u.owner == Pubkey::default() {
            u.owner = owner;
            u.bump = ctx.bumps.unclaimed;
            u.factor = rf.factor; // no share of fees paid before this balance existed
        }
        sync_refined(u, rf)?;
        u.sol = u.sol.saturating_add(sol);
        u.skr = u.skr.saturating_add(skr);
        u.ore = u.ore.saturating_add(ore);
        rf.total_unrefined = rf.total_unrefined.saturating_add(skr);
        let p = &mut ctx.accounts.player;
        p.sol_won = p.sol_won.saturating_add(sol);
        if won {
            p.ore_mined = p.ore_mined.saturating_add(ore_mined);
            p.skr_mined = p.skr_mined.saturating_add(mined);
            p.skr_won = p.skr_won.saturating_add(from_motherlode);
            p.points = p.points.saturating_add(points);
            p.wins = p.wins.saturating_add(1);
            p.xp = p.xp.saturating_add(50);
        }
        emit!(PotClaimed {
            owner,
            round_id,
            won,
            lucky,
            sol,
            skr,
            points
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

        let boost = boost_bps(cfg, p.staked_skr, p.staked_ore);
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

    /// Pay out the player's Unclaimed SOL (to their wallet) and SKR (to their SKR account).
    /// Signed by the owner or their active session key.
    pub fn claim_rewards(ctx: Context<ClaimRewards>, what: u8) -> Result<()> {
        require!(
            what & (CLAIM_SOL | CLAIM_SKR | CLAIM_ORE) != 0,
            GaliError::BadAmount
        );
        let rf = &mut ctx.accounts.refinery;
        let u = &mut ctx.accounts.unclaimed;
        sync_refined(u, rf)?;
        let sol = if what & CLAIM_SOL != 0 { u.sol } else { 0 };
        let (unrefined, refined) = if what & CLAIM_SKR != 0 {
            (u.skr, u.refined)
        } else {
            (0, 0)
        };
        let ore = if what & CLAIM_ORE != 0 { u.ore } else { 0 };
        require!(
            sol > 0 || unrefined > 0 || refined > 0 || ore > 0,
            GaliError::NothingToClaim
        );
        u.sol -= sol;
        u.skr -= unrefined;
        u.refined -= refined;
        u.ore -= ore;
        u.claimed_ore = u.claimed_ore.saturating_add(ore);
        rf.total_unrefined = rf.total_unrefined.saturating_sub(unrefined);
        rf.total_refined = rf.total_refined.saturating_sub(refined);
        // 10% of the unrefined part always comes off; it goes to whoever still holds unrefined SKR,
        // and back to the Rewards Pool when there is nobody left to share it with
        let fee = (unrefined as u128 * REFINING_FEE_BPS as u128 / BPS as u128) as u64;
        let mut to_pool = 0u64;
        if fee > 0 {
            if rf.total_unrefined > 0 {
                rf.factor += fee as u128 * FACTOR_SCALE / rf.total_unrefined as u128;
                rf.total_refined = rf.total_refined.saturating_add(fee);
            } else {
                to_pool = fee;
            }
        }
        let skr = unrefined - fee + refined;
        u.claimed_sol = u.claimed_sol.saturating_add(sol);
        u.claimed_skr = u.claimed_skr.saturating_add(skr);
        let owner = u.owner;
        if sol > 0 {
            **ctx.accounts.unclaimed.to_account_info().try_borrow_mut_lamports()? -= sol;
            **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += sol;
        }
        let bump = ctx.accounts.config.bump;
        let cfg_signer: &[&[&[u8]]] = &[&[b"config", &[bump]]];
        for (amount, to) in [
            (skr, ctx.accounts.owner_ata.to_account_info()),
            (to_pool, ctx.accounts.rewards.to_account_info()),
        ] {
            if amount == 0 {
                continue;
            }
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.pot_vault.to_account_info(),
                        mint: ctx.accounts.skr_mint.to_account_info(),
                        to,
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    cfg_signer,
                ),
                amount,
                ctx.accounts.skr_mint.decimals,
            )?;
        }
        // $ORE is paid in full: no refining fee on someone else's token
        if ore > 0 {
            token_interface::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.ore_pot_vault.to_account_info(),
                        mint: ctx.accounts.ore_mint.to_account_info(),
                        to: ctx.accounts.owner_ore_ata.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    cfg_signer,
                ),
                ore,
                ctx.accounts.ore_mint.decimals,
            )?;
        }
        emit!(RewardsClaimed {
            owner,
            sol,
            skr,
            refining_fee: fee,
            ore,
        });
        Ok(())
    }

    /// Permissionless, a day after the round ends and once every stake is claimed: closes the round's
    /// Pot and Round accounts and returns their rent (plus any rounding dust in the pot) to whoever paid it.
    pub fn close_round(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let round_end = round_end_ts(round_id, cfg.round_secs)?;
        require!(now >= round_end + CLOSE_AFTER_SECS, GaliError::TooEarly);
        {
            let pot = &ctx.accounts.pot;
            require!(pot.settled || pot.refunded > 0, GaliError::NotSettled);
            require!(pot.claimed >= pot.miners, GaliError::UnclaimedStakes);
        }
        // rounding dust (and anything else sent to the pot) goes to the treasury wallet, not the first deployer
        let info = ctx.accounts.pot.to_account_info();
        let dust = info
            .lamports()
            .saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        if dust > 0 {
            **info.try_borrow_mut_lamports()? -= dust;
            **ctx.accounts.fee_to.to_account_info().try_borrow_mut_lamports()? += dust;
        }
        emit!(RoundClosed { round_id, dust });
        Ok(())
    }

    /// If a round is still unrevealed an hour after it ended (nobody locked or revealed it), each
    /// player can take their own SOL back. Permissionless; a refunded round can never be settled.
    pub fn refund_stake(ctx: Context<RefundStake>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= round_end_ts(round_id, cfg.round_secs)? + ABANDON_SECS,
            GaliError::TooEarly
        );
        require!(
            ctx.accounts.round.data_is_empty(),
            GaliError::AlreadyRevealed
        );
        require!(!ctx.accounts.pot.settled, GaliError::AlreadySettled);
        let stake = &ctx.accounts.stake;
        let mut back = 0u64;
        for i in 0..BLOCKS as usize {
            back = back.saturating_add(stake.per_block[i]);
        }
        let owner = stake.owner;
        {
            let pot = &mut ctx.accounts.pot;
            for i in 0..BLOCKS as usize {
                pot.per_block[i] = pot.per_block[i].saturating_sub(stake.per_block[i]);
            }
            pot.total = pot.total.saturating_sub(back);
            pot.refunded = pot.refunded.saturating_add(1);
            pot.claimed = pot.claimed.saturating_add(1);
        }
        if back > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= back;
            **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? += back;
        }
        emit!(StakeRefunded {
            owner,
            round_id,
            sol: back
        });
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
        emit!(RewardsFunded {
            funder: ctx.accounts.funder.key(),
            amount
        });
        Ok(())
    }

    /// Commit a round's draw to a slot that hasn't happened yet. Anyone may call it once the round ends.
    /// It can be called again only if the target slot has fallen out of SlotHashes without a reveal.
    pub fn lock_round(ctx: Context<LockRound>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let clock = Clock::get()?;
        let round_end = round_end_ts(round_id, cfg.round_secs)?;
        require!(clock.unix_timestamp >= round_end, GaliError::RoundNotOver);
        require!(
            ctx.accounts.round.data_is_empty(),
            GaliError::AlreadyRevealed
        );
        let d = &mut ctx.accounts.draw;
        if d.target_slot != 0 {
            require!(
                clock.slot > d.target_slot.saturating_add(DRAW_EXPIRY_SLOTS),
                GaliError::AlreadyLocked
            );
        }
        d.round_id = round_id;
        d.target_slot = clock.slot + DRAW_DELAY_SLOTS;
        d.bump = ctx.bumps.draw;
        Ok(())
    }

    pub fn reveal_round(ctx: Context<RevealRound>, round_id: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let target = ctx.accounts.draw.target_slot;
        require!(target != 0, GaliError::NotLocked);

        // SlotHashes layout: u64 len, then (u64 slot, [u8;32] hash) entries, newest first.
        // Use the first slot at or after the target (the target itself may have been skipped).
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        require!(data.len() >= 8, GaliError::NoEntropy);
        let len = u64::from_le_bytes(data[0..8].try_into().unwrap()) as usize;
        let mut chosen: Option<[u8; 32]> = None;
        let mut older_seen = false;
        for i in 0..len {
            let at = 8 + i * 40;
            if at + 40 > data.len() {
                break;
            }
            let slot = u64::from_le_bytes(data[at..at + 8].try_into().unwrap());
            if slot >= target {
                chosen = Some(data[at + 8..at + 40].try_into().unwrap());
                if slot == target {
                    older_seen = true;
                    break;
                }
            } else {
                older_seen = true;
                break;
            }
        }
        // no hash yet: the target slot hasn't passed. No older entry: the target has expired.
        let recent = chosen.ok_or(GaliError::NoEntropy)?;
        require!(older_seen, GaliError::DrawExpired);
        let seed = hashv(&[&recent, &round_id.to_le_bytes(), b"gali"]).to_bytes();
        let a = u64::from_le_bytes(seed[0..8].try_into().unwrap());
        let b = u64::from_le_bytes(seed[8..16].try_into().unwrap());
        let d = u64::from_le_bytes(seed[24..32].try_into().unwrap());

        let r = &mut ctx.accounts.round;
        r.round_id = round_id;
        r.winning_block = (a % BLOCKS as u64) as u8;
        r.motherlode = b % MOTHERLODE_ODDS == 0;
        // solo spot wins: one miner takes the round's SKR; any other spot: split
        r.split_reward = solo_mask(round_id) & (1u32 << r.winning_block) == 0;
        r.lucky = d;
        r.revealed_at = now;
        r.bump = ctx.bumps.round;
        r.rent_payer = ctx.accounts.payer.key();
        emit!(Revealed {
            round_id,
            winning_block: r.winning_block,
            motherlode: r.motherlode,
            split_reward: r.split_reward,
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
        let price = *cfg
            .gear_prices_ore
            .get(item as usize)
            .ok_or(GaliError::UnknownItem)?;
        // 0 means this item is SKR-only
        require!(price > 0, GaliError::UnknownItem);
        let p = &mut ctx.accounts.player;
        require!(p.gear_mask & (1u32 << item) == 0, GaliError::AlreadyOwned);
        let to_motherlode = price.saturating_mul(cfg.ore_motherlode_bps as u64) / BPS;
        let to_rewards = price.saturating_mul(cfg.ore_rewards_bps as u64) / BPS;
        let to_treasury = price - to_motherlode - to_rewards;
        let decimals = ctx.accounts.ore_mint.decimals;
        for (amount, dest) in [
            (to_motherlode, ctx.accounts.ore_motherlode.to_account_info()),
            (to_rewards, ctx.accounts.ore_rewards.to_account_info()),
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
        emit!(StakedOre {
            owner: p.owner,
            amount,
            total: p.staked_ore
        });
        Ok(())
    }

    /// Take staked $ORE back. Locked for the round it is boosting, same rule as SKR,
    /// so the same ORE can't boost two wallets in one round.
    pub fn unstake_ore(ctx: Context<UnstakeOre>, round_id: u64, amount: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            round_id == (now / ctx.accounts.config.round_secs as i64) as u64,
            GaliError::WrongRound
        );
        require!(
            ctx.accounts.current_stake.data_is_empty(),
            GaliError::StakeInPlay
        );
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
        emit!(Staked {
            owner: p.owner,
            amount,
            total: p.staked_skr
        });
        Ok(())
    }

    pub fn unstake_skr(ctx: Context<UnstakeSkr>, round_id: u64, amount: u64) -> Result<()> {
        // staked SKR boosts the round you're playing, so it stays put until that round ends
        // (otherwise the same SKR could boost several wallets in one round)
        let now = Clock::get()?.unix_timestamp;
        require!(
            round_id == (now / ctx.accounts.config.round_secs as i64) as u64,
            GaliError::WrongRound
        );
        require!(
            ctx.accounts.current_stake.data_is_empty(),
            GaliError::StakeInPlay
        );
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
        let price = *cfg
            .gear_prices
            .get(item as usize)
            .ok_or(GaliError::UnknownItem)?;
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
    pub round_secs: u32,
    pub base_points: u64,
    pub motherlode_points: u64,
    /// raw SKR amounts (with decimals) for the 1.25x and 1.5x boosts
    pub boost_tier1: u64,
    pub boost_tier2: u64,
    /// raw SKR price per gear item, index = item id (bit in Player::gear_mask)
    #[max_len(32)]
    pub gear_prices: Vec<u64>,
    /// raw SKR moved from the Rewards Pool to the Motherlode Pool by each settled round
    pub motherlode_skr: u64,
    /// share of every gear sale routed to the Motherlode Pool, in bps
    pub motherlode_pool_bps: u16,
    /// share of every gear sale routed to the Rewards Pool, in bps (the rest goes to the treasury)
    pub rewards_pool_bps: u16,
    /// SOL fee on each losing spot (after the 1% admin fee), in bps (sent to the authority / treasury wallet)
    pub pot_fee_bps: u16,
    /// minimum lamports per block for `deploy`
    pub min_deploy: u64,
    /// raw SKR mined per round, split between the miners on the winning block
    pub round_reward_skr: u64,
    /// when true, `deploy` and `buy_gear` are refused
    pub paused: bool,
    /// set by `propose_authority`, cleared by `accept_authority`
    pub pending_authority: Pubkey,
    pub bump: u8,
    // Added with the fee-funded rewards. They sit in the old config's unused gear-price space and read as 0
    // there (0 = the old fixed payouts), so existing configs keep working after an upgrade.
    /// max share of the Rewards Pool one round can pay out (round reward + Motherlode top-up), in bps; 0 = no limit
    pub reward_drip_bps: u16,
    /// share of each round's SOL fees owed to SKR buybacks for the Rewards Pool, in bps
    pub buyback_bps: u16,
    /// lamports of fees held in the buyback escrow and not yet withdrawn to buy SKR
    pub buyback_due: u64,
    // --- $ORE: the second asset. Gali never mints it either; every ORE paid out was spent
    // on gear by a player or funded by someone. ---
    pub ore_mint: Pubkey,
    /// raw ORE price per gear item, index = item id. Empty or 0 = that item cannot be bought with ORE.
    #[max_len(32)]
    pub gear_prices_ore: Vec<u64>,
    /// share of every ORE gear sale routed to the ORE Motherlode Pool, in bps
    pub ore_motherlode_bps: u16,
    /// share of every ORE gear sale routed to the ORE Rewards Pool, in bps (the rest goes to the treasury)
    pub ore_rewards_bps: u16,
    /// raw ORE staked for the 1.25x and 1.5x boosts; the better of the SKR and ORE boosts applies
    pub ore_boost_tier1: u64,
    pub ore_boost_tier2: u64,
    /// raw ORE mined per round by the winning spot, and moved into the ORE Motherlode Pool each round
    pub round_reward_ore: u64,
    pub motherlode_ore: u64,
    /// max share of the ORE Rewards Pool one round can pay out, in bps
    pub ore_drip_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct ConfigUpdate {
    pub base_points: Option<u64>,
    pub motherlode_points: Option<u64>,
    pub boost_tier1: Option<u64>,
    pub boost_tier2: Option<u64>,
    pub gear_prices: Option<Vec<u64>>,
    pub motherlode_skr: Option<u64>,
    pub motherlode_pool_bps: Option<u16>,
    pub rewards_pool_bps: Option<u16>,
    pub pot_fee_bps: Option<u16>,
    pub min_deploy: Option<u64>,
    pub round_reward_skr: Option<u64>,
    pub reward_drip_bps: Option<u16>,
    pub buyback_bps: Option<u16>,
    pub gear_prices_ore: Option<Vec<u64>>,
    pub ore_motherlode_bps: Option<u16>,
    pub ore_rewards_bps: Option<u16>,
    pub ore_boost_tier1: Option<u64>,
    pub ore_boost_tier2: Option<u64>,
    pub round_reward_ore: Option<u64>,
    pub motherlode_ore: Option<u64>,
    pub ore_drip_bps: Option<u16>,
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
    pub reward_drip_bps: u16,
    pub buyback_bps: u16,
    pub gear_prices_ore: Vec<u64>,
    pub ore_motherlode_bps: u16,
    pub ore_rewards_bps: u16,
    pub ore_boost_tier1: u64,
    pub ore_boost_tier2: u64,
    pub round_reward_ore: u64,
    pub motherlode_ore: u64,
    pub ore_drip_bps: u16,
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
    pub reserved: [u8; 40],
}

#[account]
#[derive(InitSpace)]
pub struct Round {
    pub round_id: u64,
    pub winning_block: u8,
    pub motherlode: bool,
    /// true: the round's SKR is split pro rata; false: a solo spot won and one miner takes it all
    pub split_reward: bool,
    /// random number used to draw the lucky winner
    pub lucky: u64,
    pub revealed_at: i64,
    pub bump: u8,
    /// paid this account's rent; refunded by `close_round`
    pub rent_payer: Pubkey,
    pub reserved: [u8; 32],
}

/// A round's committed draw slot (closed by `reveal_round`).
#[account]
#[derive(InitSpace)]
pub struct Draw {
    pub round_id: u64,
    pub target_slot: u64,
    pub bump: u8,
}

/// One per round: SOL on each block (the lamports sit in this account).
#[account]
#[derive(InitSpace)]
pub struct Pot {
    pub round_id: u64,
    pub per_block: [u64; 25],
    pub total: u64,
    /// lamports the winning spot's miners split after fees (set by `settle_pot`)
    pub pool: u64,
    /// raw SKR mined this round, and the Motherlode Pool paid out (both escrowed in `pot_vault`)
    pub skr_reward: u64,
    pub motherlode_skr: u64,
    pub motherlode: bool,
    /// copied from the round at settlement
    pub split_reward: bool,
    pub lucky_index: u64,
    pub miners: u32,
    pub settled: bool,
    pub bump: u8,
    /// fees taken at settlement, and the fee rate used for losing spots
    pub admin_fee: u64,
    pub protocol_fee: u64,
    pub fee_bps: u16,
    /// the miner who took the round's SKR on a solo spot (set when their stake is claimed)
    pub winner: Pubkey,
    /// stakes on the winning spot claimed so far
    pub winners_paid: u32,
    /// paid this account's rent (the round's first deployer); refunded by `close_round`
    pub rent_payer: Pubkey,
    /// stakes claimed so far (all of them: `claimed == miners`)
    pub claimed: u32,
    /// points settings fixed when the round opened
    pub base_points: u64,
    pub motherlode_points: u64,
    /// stakes refunded because the round was never revealed; any refund blocks settlement
    pub refunded: u32,
    /// raw ORE mined this round and the ORE Motherlode paid out (both escrowed in `ore_pot_vault`)
    pub ore_reward: u64,
    pub motherlode_ore: u64,
    /// room for later fields, so upgrades don't strand existing rounds
    pub reserved: [u8; 48],
}

/// One per player: SOL and SKR credited by `claim_pot`, waiting for `claim_rewards`.
/// The SOL sits in this account; the SKR in `pot_vault`.
#[account]
#[derive(InitSpace)]
pub struct Unclaimed {
    pub owner: Pubkey,
    /// lamports waiting to be claimed
    pub sol: u64,
    /// unrefined SKR (mined in rounds); claiming it costs the refining fee
    pub skr: u64,
    /// refined SKR (a share of other players' refining fees); claimed without a fee
    pub refined: u64,
    /// refinery accumulator at the last sync
    pub factor: u128,
    pub claimed_sol: u64,
    pub claimed_skr: u64,
    pub bump: u8,
    /// mined $ORE waiting to be claimed. No refining fee: ORE is not Gali's token to tax.
    pub ore: u64,
    pub claimed_ore: u64,
    pub reserved: [u8; 48],
}

/// Holds the share of SOL fees owed to SKR buybacks until the admin withdraws it.
#[account]
#[derive(InitSpace)]
pub struct Buyback {
    pub bump: u8,
    pub reserved: [u8; 32],
}

/// Global refining-fee accumulator (one account).
#[account]
#[derive(InitSpace)]
pub struct Refinery {
    /// refined SKR per unrefined SKR, times FACTOR_SCALE, summed over all refining fees
    pub factor: u128,
    pub total_unrefined: u64,
    pub total_refined: u64,
    pub bump: u8,
    pub reserved: [u8; 64],
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
    /// where this stake's lamports start on each block (the pot's total there before it deposited)
    pub start: [u64; 25],
    /// points boost locked in at the player's first deploy of the round
    pub boost_bps: u16,
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
    #[account(init, payer = authority, space = 8 + Buyback::INIT_SPACE, seeds = [b"buyback"], bump)]
    pub buyback: Box<Account<'info, Buyback>>,
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
    #[account(
        init, payer = authority, seeds = [b"ore_rewards"], bump,
        token::mint = ore_mint, token::authority = config, token::token_program = token_program
    )]
    pub ore_rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init, payer = authority, seeds = [b"ore_pot_vault"], bump,
        token::mint = ore_mint, token::authority = config, token::token_program = token_program
    )]
    pub ore_pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
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
pub struct MarkBuyback<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"buyback"], bump = buyback.bump)]
    pub buyback: Box<Account<'info, Buyback>>,
    /// CHECK: where the SOL goes to be swapped for SKR
    #[account(mut)]
    pub destination: UncheckedAccount<'info>,
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
    #[account(mut, seeds = [b"ore_rewards"], bump)]
    pub ore_rewards: Box<InterfaceAccount<'info, TokenAccount>>,
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
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump = round.bump)]
    pub round: Box<Account<'info, Round>>,
    #[account(mut, seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump = pot.bump)]
    pub pot: Box<Account<'info, Pot>>,
    /// CHECK: SOL fee destination, pinned to the config authority (treasury wallet)
    #[account(mut, address = config.authority)]
    pub fee_to: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"buyback"], bump = buyback.bump)]
    pub buyback: Box<Account<'info, Buyback>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"rewards"], bump)]
    pub rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"motherlode"], bump)]
    pub motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"pot_vault"], bump)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.ore_mint @ GaliError::BadConfig)]
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"ore_rewards"], bump)]
    pub ore_rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"ore_motherlode"], bump)]
    pub ore_motherlode: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"ore_pot_vault"], bump)]
    pub ore_pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct ClaimPot<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: identity only; must be the stake's owner
    #[account(address = stake.owner)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: rent refund destination, must match the stake's payer
    #[account(mut, address = stake.payer)]
    pub payer: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
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
    #[account(
        init_if_needed, payer = cranker, space = 8 + Unclaimed::INIT_SPACE,
        seeds = [b"unclaimed", owner.key().as_ref()], bump
    )]
    pub unclaimed: Box<Account<'info, Unclaimed>>,
    #[account(
        init_if_needed, payer = cranker, space = 8 + Refinery::INIT_SPACE,
        seeds = [b"refinery"], bump
    )]
    pub refinery: Box<Account<'info, Refinery>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CloseRound<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut, close = pot_rent_payer,
        seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump = pot.bump
    )]
    pub pot: Box<Account<'info, Pot>>,
    #[account(
        mut, close = round_rent_payer,
        seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump = round.bump
    )]
    pub round: Box<Account<'info, Round>>,
    /// CHECK: rent refund destination, pinned to the pot's payer
    #[account(mut, address = pot.rent_payer)]
    pub pot_rent_payer: UncheckedAccount<'info>,
    /// CHECK: rent refund destination, pinned to the round's payer
    #[account(mut, address = round.rent_payer)]
    pub round_rent_payer: UncheckedAccount<'info>,
    /// CHECK: leftover lamports go to the treasury wallet
    #[account(mut, address = config.authority)]
    pub fee_to: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct RefundStake<'info> {
    #[account(mut)]
    pub cranker: Signer<'info>,
    /// CHECK: gets its own SOL back; must be the stake's owner
    #[account(mut, address = stake.owner)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: rent refund destination, must match the stake's payer
    #[account(mut, address = stake.payer)]
    pub payer: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"pot".as_ref(), round_id.to_le_bytes().as_ref()], bump = pot.bump)]
    pub pot: Box<Account<'info, Pot>>,
    /// CHECK: must still be empty (the round was never revealed); only its data length is read.
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump)]
    pub round: UncheckedAccount<'info>,
    #[account(
        mut, close = payer,
        seeds = [b"stake", owner.key().as_ref(), &round_id.to_le_bytes()], bump = stake.bump
    )]
    pub stake: Box<Account<'info, Stake>>,
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// the player's own wallet: session keys can deploy, but never move rewards out
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = skr_mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [b"player", owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [b"unclaimed", owner.key().as_ref()], bump = unclaimed.bump, has_one = owner)]
    pub unclaimed: Box<Account<'info, Unclaimed>>,
    #[account(mut, seeds = [b"refinery"], bump = refinery.bump)]
    pub refinery: Box<Account<'info, Refinery>>,
    pub skr_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"pot_vault"], bump)]
    pub pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, seeds = [b"rewards"], bump)]
    pub rewards: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = owner,
        associated_token::mint = skr_mint, associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.ore_mint @ GaliError::BadConfig)]
    pub ore_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, seeds = [b"ore_pot_vault"], bump)]
    pub ore_pot_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = owner,
        associated_token::mint = ore_mint, associated_token::authority = owner,
        associated_token::token_program = token_program
    )]
    pub owner_ore_ata: Box<InterfaceAccount<'info, TokenAccount>>,
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
    #[account(
        mut, close = payer,
        seeds = [b"draw".as_ref(), round_id.to_le_bytes().as_ref()], bump = draw.bump
    )]
    pub draw: Account<'info, Draw>,
    /// CHECK: address-constrained to the SlotHashes sysvar; only raw bytes are read.
    #[account(address = slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct LockRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed, payer = payer, space = 8 + Draw::INIT_SPACE,
        seeds = [b"draw".as_ref(), round_id.to_le_bytes().as_ref()], bump
    )]
    pub draw: Account<'info, Draw>,
    /// CHECK: must still be empty (the round isn't revealed); only its data length is read.
    #[account(seeds = [b"round".as_ref(), round_id.to_le_bytes().as_ref()], bump)]
    pub round: UncheckedAccount<'info>,
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
    #[account(mut, seeds = [b"ore_rewards"], bump)]
    pub ore_rewards: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
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
    /// CHECK: the owner's stake for the current round; must not exist. Only its data length is read.
    #[account(seeds = [b"stake", owner.key().as_ref(), &round_id.to_le_bytes()], bump)]
    pub current_stake: UncheckedAccount<'info>,
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
    /// CHECK: the owner's stake for the current round; must not exist. Only its data length is read.
    #[account(seeds = [b"stake", owner.key().as_ref(), &round_id.to_le_bytes()], bump)]
    pub current_stake: UncheckedAccount<'info>,
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
    pub split_reward: bool,
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
    pub motherlode_skr: u64,
    pub motherlode_accrued: u64,
}

#[event]
pub struct PotClaimed {
    pub owner: Pubkey,
    pub round_id: u64,
    pub won: bool,
    /// took the whole SKR reward in a single-winner round
    pub lucky: bool,
    pub sol: u64,
    pub skr: u64,
    pub points: u64,
}

#[event]
pub struct RoundClosed {
    pub round_id: u64,
    pub dust: u64,
}

#[event]
pub struct StakeRefunded {
    pub owner: Pubkey,
    pub round_id: u64,
    pub sol: u64,
}

#[event]
pub struct BuybackMarked {
    pub lamports: u64,
    pub due: u64,
}

#[event]
pub struct RewardsClaimed {
    pub owner: Pubkey,
    pub sol: u64,
    /// SKR paid out (after the refining fee)
    pub skr: u64,
    pub refining_fee: u64,
    /// ORE paid out, in full
    pub ore: u64,
}

#[event]
pub struct RewardsFunded {
    pub funder: Pubkey,
    pub amount: u64,
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
}
