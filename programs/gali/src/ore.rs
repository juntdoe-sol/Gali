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
use anchor_lang::solana_program::keccak;

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
    pub const CUMULATIVE: usize = 456;
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
}

impl OreRound {
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

        let top_miner = key_at(&data, round_at::TOP_MINER);
        Ok(Self {
            id,
            deployed: squares_at(&data, round_at::DEPLOYED),
            winning_square: Some(square),
            split: top_miner == ORE_SPLIT,
            motherlode: u64_at(&data, round_at::MOTHERLODE),
        })
    }
}

/// What Gali needs out of one player's ORE miner account.
pub struct OreMiner {
    pub authority: Pubkey,
    pub round_id: u64,
    /// Lamports this miner had on each square in `round_id`.
    pub deployed: [u64; 25],
    /// The running total already on each square when they deployed there.
    pub cumulative: [u64; 25],
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
            cumulative: squares_at(&data, miner_at::CUMULATIVE),
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

/// ORE's solo/split mask for a round: a set bit marks a square that pays one winner.
///
/// This is ORE's own rule reimplemented, not a lookup: keccak the round id, use
/// it to Fisher-Yates shuffle the 25 indices, and the first ten are solo. It has
/// to match ORE exactly, so it is covered by `tests/ore-mask.ts` against real
/// settled rounds.
pub fn solo_mask_ore(round_id: u64) -> u32 {
    let mut randomness = keccak::hashv(&[round_id.to_le_bytes().as_ref()]).0;
    let mut offset = 0usize;

    let mut indices = [0u8; 25];
    for (i, slot) in indices.iter_mut().enumerate() {
        *slot = i as u8;
    }

    for i in (1..25usize).rev() {
        if offset + 2 > randomness.len() {
            randomness = keccak::hashv(&[&randomness]).0;
            offset = 0;
        }
        let r = u16::from_le_bytes([randomness[offset], randomness[offset + 1]]);
        let j = (r as usize) % (i + 1);
        indices.swap(i, j);
        offset += 2;
    }

    let mut mask = 0u32;
    for idx in indices.iter().take(10) {
        mask |= 1 << *idx;
    }
    mask
}

/// True when the square's reward is shared rather than taken by one wallet.
pub fn is_split_square(round_id: u64, square: usize) -> bool {
    solo_mask_ore(round_id) & (1u32 << square) == 0
}

/// Whether this miner took the solo reward on the winning square.
///
/// ORE samples a point inside the square's total and gives it to whoever's
/// `[cumulative, cumulative + deployed)` interval covers it. Odds are the size
/// of your slice, not how early you deployed.
pub fn is_solo_winner(round: &OreRound, miner: &OreMiner, entropy_rng: u64) -> bool {
    let Some(square) = round.winning_square else {
        return false;
    };
    let total = round.deployed[square];
    if total == 0 || miner.deployed[square] == 0 {
        return false;
    }
    let sample = entropy_rng.reverse_bits() % total;
    sample >= miner.cumulative[square]
        && sample < miner.cumulative[square].saturating_add(miner.deployed[square])
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
