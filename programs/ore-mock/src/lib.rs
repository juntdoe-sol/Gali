//! A stand-in for ORE's program, deployed at ORE's address in tests only.
//!
//! Gali reads ORE's Board, Round and Miner accounts byte for byte. Those accounts
//! only exist on mainnet, behind a program built with Steel that needs a Rust
//! toolchain and crates.io to build. Testing against them would mean either
//! spending real SOL every round or carrying ORE's whole build.
//!
//! So this deploys at ORE's program id on a local validator and does one thing:
//! create the PDAs ORE would create, at the seeds ORE uses, and put bytes in them.
//! That makes the interesting cases reachable. A round where the motherlode hit, a
//! solo square, a split square, a miner who was on the losing side, a round that
//! never drew. Several of those are rare enough on mainnet that waiting for one is
//! not a test strategy.
//!
//! It is a fixture, not a simulation. It does not enforce ORE's rules, and nothing
//! it does proves Gali would work against the real program. What it does prove is
//! that Gali reads the layout correctly and does the right arithmetic on it, which
//! is the part most likely to be wrong.
//!
//! Never deploy this anywhere but a test validator.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;

declare_id!("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");

/// Steel's account sizes, discriminator included.
const BOARD_LEN: usize = 8 + 32;
const ROUND_LEN: usize = 8 + 944;
const MINER_LEN: usize = 8 + 744;

#[program]
pub mod ore_mock {
    use super::*;

    /// Create or overwrite ORE's board at its fixed address.
    pub fn put_board(ctx: Context<PutBoard>, data: Vec<u8>) -> Result<()> {
        write_pda(
            &ctx.accounts.account,
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            &[b"board", &[ctx.bumps.account]],
            BOARD_LEN,
            &data,
        )
    }

    /// Create or overwrite a round account at ORE's `["round", id]` seeds.
    pub fn put_round(ctx: Context<PutRound>, round_id: u64, data: Vec<u8>) -> Result<()> {
        write_pda(
            &ctx.accounts.account,
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            &[b"round", &round_id.to_le_bytes()[..], &[ctx.bumps.account]],
            ROUND_LEN,
            &data,
        )
    }

    /// Create or overwrite a miner account at ORE's `["miner", authority]` seeds.
    pub fn put_miner(ctx: Context<PutMiner>, authority: Pubkey, data: Vec<u8>) -> Result<()> {
        write_pda(
            &ctx.accounts.account,
            &ctx.accounts.payer,
            &ctx.accounts.system_program,
            &[b"miner", authority.as_ref(), &[ctx.bumps.account]],
            MINER_LEN,
            &data,
        )
    }
}

/// Allocates the account on first use, then copies `data` over its contents.
/// `data` may be shorter than the account; the rest is left as it was.
fn write_pda<'info>(
    account: &AccountInfo<'info>,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
    seeds: &[&[u8]],
    len: usize,
    data: &[u8],
) -> Result<()> {
    require!(data.len() <= len, ErrorCode::ConstraintSpace);
    if account.data_is_empty() {
        let lamports = Rent::get()?.minimum_balance(len);
        invoke_signed(
            &system_instruction::create_account(payer.key, account.key, lamports, len as u64, &crate::ID),
            &[payer.to_account_info(), account.clone(), system_program.to_account_info()],
            &[seeds],
        )?;
    }
    account.try_borrow_mut_data()?[..data.len()].copy_from_slice(data);
    Ok(())
}

#[derive(Accounts)]
pub struct PutBoard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: written as raw bytes; this program is a test fixture.
    #[account(mut, seeds = [b"board"], bump)]
    pub account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct PutRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: written as raw bytes; this program is a test fixture.
    #[account(mut, seeds = [b"round", round_id.to_le_bytes().as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authority: Pubkey)]
pub struct PutMiner<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: written as raw bytes; this program is a test fixture.
    #[account(mut, seeds = [b"miner", authority.as_ref()], bump)]
    pub account: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
