//! Reading ORE's board from inside Gali's program.
//!
//! Gali no longer runs a round. ORE does. What Gali needs is to look at a
//! finished ORE round and answer three questions about one player: did they
//! play it, were they on the winning square, and how big was their share of it.
//! Points, streaks, quests and the SKR motherlode bonus all follow from that.
//!
//! ORE is built with Steel, so its accounts are plain `#[repr(C)]` bytes with an
//! 8-byte discriminator in front and no Anchor wrapper to lean on. Every offset
//! below was confirmed against live mainnet accounts; `scripts/ore-probe.ts`
//! re-runs that check and `scripts/ore-layout.json` records it. The readers here
//! refuse to guess: wrong owner, wrong length or wrong PDA and they error out
//! rather than decode whatever happens to be at that address.
//!
//! Nothing in this module writes to an ORE account. Gali only ever reads.

use anchor_lang::prelude::*;

use crate::GaliError;

/// The $ORE program. Mainnet only; ORE has no devnet deployment.
pub const ORE_PROGRAM_ID: Pubkey = pubkey!("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");
/// ORE's singleton board, at a fixed address rather than a derived one.
pub const ORE_BOARD: Pubkey = pubkey!("BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi");
/// Written into `Round.top_miner` when the square's reward is split.
pub const ORE_SPLIT: Pubkey = pubkey!("SpLiT11111111111111111111111111111111111112");

pub const ORE_MINER_SEED: &[u8] = b"miner";
pub const ORE_ROUND_SEED: &[u8] = b"round";

/// Steel prefixes every account with an 8-byte discriminator.
const DISC: usize = 8;

/// Byte offsets inside ORE's `Round`, before the discriminator is added.
mod round_at {
    pub const ID: usize = 0;
    pub const DEPLOYED: usize = 8;
    pub const SLOT_HASH: usize = 608;
    pub const EXPIRES_AT: usize = 640;
    pub const MOTHERLODE: usize = 648;
    pub const TOP_MINER: usize = 912;
    pub const SIZE: usize = 944;
}

/// Byte offsets inside ORE's `Miner`. `rewards_factor` is a 16-byte Numeric,
/// which is what puts the tail fields where they are.
mod miner_at {
    pub const AUTHORITY: usize = 0;
    pub const CHECKPOINT_ID: usize = 40;
    pub const DEPLOYED: usize = 56;
    pub const ROUND_ID: usize = 656;
    pub const SIZE: usize = 744;
}

/// Byte offsets inside ORE's `Board`.
mod board_at {
    pub const ROUND_ID: usize = 0;
    pub const SIZE: usize = 32;
}

fn u64_at(data: &[u8], off: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&data[DISC + off..DISC + off + 8]);
    u64::from_le_bytes(b)
}

fn key_at(data: &[u8], off: usize) -> Pubkey {
    let mut b = [0u8; 32];
    b.copy_from_slice(&data[DISC + off..DISC + off + 32]);
    Pubkey::new_from_array(b)
}

fn squares_at(data: &[u8], off: usize) -> [u64; 25] {
    let mut out = [0u64; 25];
    for (i, slot) in out.iter_mut().enumerate() {
        *slot = u64_at(data, off + i * 8);
    }
    out
}

/// Checks an account really is the ORE account we asked for, then hands back its bytes.
fn ore_bytes<'a>(
    info: &'a AccountInfo<'_>,
    expected: Pubkey,
    size: usize,
) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    require_keys_eq!(*info.key, expected, GaliError::BadOreAccount);
    require_keys_eq!(*info.owner, ORE_PROGRAM_ID, GaliError::BadOreAccount);
    let data = info.try_borrow_data()?;
    require!(data.len() == DISC + size, GaliError::BadOreLayout);
    Ok(data)
}

/// What Gali needs out of a finished ORE round.
pub struct OreRound {
    pub id: u64,
    /// Lamports on each of the 25 squares.
    pub deployed: [u64; 25],
    /// The square that struck gold, or `None` while the round is unsettled.
    pub winning_square: Option<usize>,
    /// True when the winning square's ORE is shared by everyone on it.
    pub split: bool,
    /// Grams of ORE paid out as ORE's own motherlode this round. Non-zero on a hit.
    pub motherlode: u64,
    /// Slot after which ORE may close this account and its rewards are forfeit.
    pub expires_at: u64,
}

/// ORE sets a round's expiry one day of slots past the slot mining closed.
const ONE_DAY_SLOTS: u64 = 24 * 60 * 200;

/// How far a round's expiry may sit from the current slot, either way, before the
/// bytes are treated as a layout change rather than a round. ORE writes
/// `end_slot + ONE_DAY_SLOTS` on a round's first deploy (and `u64::MAX` before it),
/// so a finished round sits about a day ahead; three days either way is loose.
pub const MAX_EXPIRY_DRIFT_SLOTS: u64 = 3 * ONE_DAY_SLOTS;

/// The most ORE a motherlode can hold: ORE's whole 3,000,000 max supply at 11
/// decimals (`ore_mint_api::consts::MAX_SUPPLY`). Anything above it cannot be a
/// real payout, only a misread field.
pub const MAX_MOTHERLODE_GRAMS: u64 = 3_000_000 * 100_000_000_000;

impl OreRound {
    /// The slot at which mining closed. Derived, because the round account keeps
    /// its expiry rather than its end, and the two differ by a fixed day.
    pub fn end_slot(&self) -> u64 {
        self.expires_at.saturating_sub(ONE_DAY_SLOTS)
    }

    /// Reads round `round_id` from its own PDA.
    ///
    /// The account is only accepted once it has settled: an all-zero entropy
    /// value means the draw has not happened, and awarding anything from that
    /// would be awarding from a result nobody knows yet.
    pub fn load(info: &AccountInfo<'_>, round_id: u64) -> Result<Self> {
        let (expected, _) = Pubkey::find_program_address(
            &[ORE_ROUND_SEED, &round_id.to_le_bytes()],
            &ORE_PROGRAM_ID,
        );
        let data = ore_bytes(info, expected, round_at::SIZE)?;

        let id = u64_at(&data, round_at::ID);
        require!(id == round_id, GaliError::BadOreAccount);

        let entropy = &data[DISC + round_at::SLOT_HASH..DISC + round_at::SLOT_HASH + 32];
        require!(entropy.iter().any(|b| *b != 0), GaliError::OreRoundUnsettled);

        // ORE picks the square by xoring the four words of the entropy, mod 25.
        let mut rng = 0u64;
        for chunk in entropy.chunks_exact(8) {
            let mut w = [0u8; 8];
            w.copy_from_slice(chunk);
            rng ^= u64::from_le_bytes(w);
        }
        let square = (rng % 25) as usize;

        // Range checks: if ORE moves a field, these trip before a misread value pays anything.
        let expires_at = u64_at(&data, round_at::EXPIRES_AT);
        let slot = Clock::get()?.slot;
        require!(
            expires_at.abs_diff(slot) <= MAX_EXPIRY_DRIFT_SLOTS,
            GaliError::BadOreLayout
        );
        let motherlode = u64_at(&data, round_at::MOTHERLODE);
        require!(motherlode <= MAX_MOTHERLODE_GRAMS, GaliError::BadOreLayout);

        let top_miner = key_at(&data, round_at::TOP_MINER);
        Ok(Self {
            id,
            deployed: squares_at(&data, round_at::DEPLOYED),
            winning_square: Some(square),
            split: top_miner == ORE_SPLIT,
            motherlode,
            expires_at,
        })
    }
}

/// What Gali needs out of one player's ORE miner account.
pub struct OreMiner {
    pub authority: Pubkey,
    pub round_id: u64,
    /// Lamports this miner had on each square in `round_id`.
    pub deployed: [u64; 25],
}

impl OreMiner {
    /// Reads `authority`'s miner account and insists it has been settled for `round_id`.
    ///
    /// ORE clears `deployed` on the next deploy, not at checkpoint, so a settled
    /// miner still carries the round it just played. ORE also refuses to deploy
    /// into a new round until the previous one is checkpointed, which is what
    /// makes `checkpoint_id == round_id` a safe "this result is final" test.
    pub fn load(info: &AccountInfo<'_>, authority: &Pubkey, round_id: u64) -> Result<Self> {
        let (expected, _) =
            Pubkey::find_program_address(&[ORE_MINER_SEED, authority.as_ref()], &ORE_PROGRAM_ID);
        let data = ore_bytes(info, expected, miner_at::SIZE)?;

        require_keys_eq!(
            key_at(&data, miner_at::AUTHORITY),
            *authority,
            GaliError::BadOreAccount
        );
        require!(
            u64_at(&data, miner_at::ROUND_ID) == round_id,
            GaliError::OreRoundMismatch
        );
        require!(
            u64_at(&data, miner_at::CHECKPOINT_ID) == round_id,
            GaliError::OreNotCheckpointed
        );

        Ok(Self {
            authority: *authority,
            round_id,
            deployed: squares_at(&data, miner_at::DEPLOYED),
        })
    }

    /// Total lamports this miner put on the board in the round.
    pub fn total_deployed(&self) -> u64 {
        self.deployed.iter().copied().fold(0u64, u64::saturating_add)
    }
}

/// Reads the board's current round id, used to refuse rounds that are still live.
pub fn board_round_id(info: &AccountInfo<'_>) -> Result<u64> {
    let data = ore_bytes(info, ORE_BOARD, board_at::SIZE)?;
    Ok(u64_at(&data, board_at::ROUND_ID))
}

/// A miner's share of the winning square, in basis points of that square's total.
///
/// This is what Gali's SKR motherlode bonus is paid on, so that the SKR follows
/// exactly the proportions ORE used for the ORE.
pub fn winning_share_bps(round: &OreRound, miner: &OreMiner) -> u64 {
    let Some(square) = round.winning_square else {
        return 0;
    };
    let total = round.deployed[square];
    if total == 0 {
        return 0;
    }
    ((miner.deployed[square] as u128 * 10_000u128) / total as u128) as u64
}
