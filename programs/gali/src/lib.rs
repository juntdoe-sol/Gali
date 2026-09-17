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
pub const CLOSE_AFTER_SECS: i64 = SECONDS_PER_DAY;
pub const CLAIM_SOL: u8 = 1;
pub const CLAIM_SKR: u8 = 2;
/// Taken from every spot, win or lose (sent to the treasury wallet).
pub const ADMIN_FEE_BPS: u64 = 100;
/// Spots per round where the winner takes the whole SKR reward.
pub const SOLO_SPOTS: usize = 10;
/// `lock_round` targets the slot this many slots ahead.
pub const DRAW_DELAY_SLOTS: u64 = 2;
/// SlotHashes keeps 512 entries; after this many slots a lock is treated as expired and can be redone.
pub const DRAW_EXPIRY_SLOTS: u64 = 450;

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
fn sync_refined(u: &mut Unclaimed, rf: &Refinery) {
    if rf.factor > u.factor {
        let gain = (rf.factor - u.factor)
            .checked_mul(u.skr as u128)
            .map(|v| v / FACTOR_SCALE)
            .unwrap_or(0) as u64;
        u.refined = u.refined.saturating_add(gain);
    }
    u.factor = rf.factor;
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
    require!(cfg.reward_drip_bps <= MAX_DRIP_BPS, GaliError::BadConfig);
    require!(cfg.buyback_bps as u64 <= BPS, GaliError::BadConfig);
    require!(
        cfg.boost_tier2 == 0 || cfg.boost_tier2 >= cfg.boost_tier1,
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
        c.paused = false;
        c.pending_authority = Pubkey::default();
        c.bump = ctx.bumps.config;
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
        check_config(c)?;
        emit!(ConfigUpdated {
            authority: c.authority
        });
        Ok(())
    }

    /// Record SOL from `buyback_due` that the admin has spent buying SKR for the Rewards Pool.
    pub fn mark_buyback(ctx: Context<AdminConfig>, lamports: u64) -> Result<()> {
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
        let has_winners = ctx.accounts.pot.per_block[win] > 0;
        let fee_bps = cfg.pot_fee_bps;

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
        if fee > 0 {
            **ctx.accounts.pot.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_to.to_account_info().try_borrow_mut_lamports()? += fee;
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
        let owed = (fee as u128 * cfg.buyback_bps as u128 / BPS as u128) as u64;
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

        ctx.accounts.config.buyback_due = ctx.accounts.config.buyback_due.saturating_add(owed);
        let pot = &mut ctx.accounts.pot;
        pot.pool = total - fee;
        pot.admin_fee = admin_fee;
        pot.protocol_fee = protocol_fee;
        pot.fee_bps = fee_bps;
        pot.skr_reward = from_rewards;
        pot.motherlode_skr = from_motherlode;
        pot.motherlode = r.motherlode;
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
        let points = if won {
            let cfg = &ctx.accounts.config;
            let covered = stake.per_block.iter().filter(|v| **v > 0).count() as u64;
            let mut base = cfg.base_points.saturating_mul(BLOCKS as u64) / covered.max(1);
            if pot.motherlode {
                base = base.saturating_add(cfg.motherlode_points);
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
        sync_refined(u, rf);
        u.sol = u.sol.saturating_add(sol);
        u.skr = u.skr.saturating_add(skr);
        rf.total_unrefined = rf.total_unrefined.saturating_add(skr);
        let p = &mut ctx.accounts.player;
        p.sol_won = p.sol_won.saturating_add(sol);
        if won {
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

    /// Pay out the player's Unclaimed SOL (to their wallet) and SKR (to their SKR account).
    /// Signed by the owner or their active session key.
    pub fn claim_rewards(ctx: Context<ClaimRewards>, what: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let signer = ctx.accounts.signer.key();
        {
            let p = &ctx.accounts.player;
            let is_owner = signer == p.owner;
            let is_session =
                signer == p.session && p.session != Pubkey::default() && now < p.session_expires;
            require!(is_owner || is_session, GaliError::NotAuthorised);
        }
        require!(what & (CLAIM_SOL | CLAIM_SKR) != 0, GaliError::BadAmount);
        let rf = &mut ctx.accounts.refinery;
        let u = &mut ctx.accounts.unclaimed;
        sync_refined(u, rf);
        let sol = if what & CLAIM_SOL != 0 { u.sol } else { 0 };
        let (unrefined, refined) = if what & CLAIM_SKR != 0 {
            (u.skr, u.refined)
        } else {
            (0, 0)
        };
        require!(sol > 0 || unrefined > 0 || refined > 0, GaliError::NothingToClaim);
        u.sol -= sol;
        u.skr -= unrefined;
        u.refined -= refined;
        rf.total_unrefined = rf.total_unrefined.saturating_sub(unrefined);
        rf.total_refined = rf.total_refined.saturating_sub(refined);
        // 10% of the unrefined part goes to whoever still holds unrefined SKR
        let mut fee = (unrefined as u128 * REFINING_FEE_BPS as u128 / BPS as u128) as u64;
        if fee > 0 && rf.total_unrefined >= fee {
            rf.factor += fee as u128 * FACTOR_SCALE / rf.total_unrefined as u128;
            rf.total_refined = rf.total_refined.saturating_add(fee);
        } else {
            fee = 0; // nobody (or almost nobody) left to share it with
        }
        let skr = unrefined - fee + refined;
        u.claimed_sol = u.claimed_sol.saturating_add(sol);
        u.claimed_skr = u.claimed_skr.saturating_add(skr);
        let owner = u.owner;
        if sol > 0 {
            **ctx.accounts.unclaimed.to_account_info().try_borrow_mut_lamports()? -= sol;
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
        emit!(RewardsClaimed {
            owner,
            sol,
            skr,
            refining_fee: fee,
        });
        Ok(())
    }

    /// Permissionless, a day after the round ends and once every stake is claimed: closes the round's
    /// Pot and Round accounts and returns their rent (plus any rounding dust in the pot) to whoever paid it.
    pub fn close_round(ctx: Context<CloseRound>, round_id: u64) -> Result<()> {
        let cfg = &ctx.accounts.config;
        let now = Clock::get()?.unix_timestamp;
        let round_end = (round_id as i64 + 1) * cfg.round_secs as i64;
        require!(now >= round_end + CLOSE_AFTER_SECS, GaliError::TooEarly);
        let pot = &ctx.accounts.pot;
        require!(pot.settled, GaliError::NotSettled);
        require!(pot.claimed >= pot.miners, GaliError::UnclaimedStakes);
        emit!(RoundClosed { round_id });
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
        let round_end = (round_id as i64 + 1) * cfg.round_secs as i64;
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
    /// lamports of fees owed to buybacks and not yet marked as spent
    pub buyback_due: u64,
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
    /// true: the round's SKR is split pro rata; false: a solo spot won and one miner takes it all
    pub split_reward: bool,
    /// random number used to draw the lucky winner
    pub lucky: u64,
    pub revealed_at: i64,
    pub bump: u8,
    /// paid this account's rent; refunded by `close_round`
    pub rent_payer: Pubkey,
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
}

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// the player's wallet or their active session key (pays for the SKR account if it's missing)
    #[account(mut)]
    pub signer: Signer<'info>,
    /// CHECK: receives the SOL; bound to `player` via has_one
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
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
    #[account(
        init_if_needed, payer = signer,
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
}
