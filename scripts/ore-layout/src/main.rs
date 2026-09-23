//! Dumps ORE's account layout as JSON, straight from ore-api.
//!
//! Gali's TypeScript client has to read ORE's Board, Round, Miner and Automation
//! accounts byte for byte. ORE uses Steel, so there is no IDL and no generated
//! client. Rather than count offsets by hand and be subtly wrong, this asks the
//! Rust types themselves.
//!
//!   cargo run --release > ../ore-layout.json

use ore_api::consts::*;
use ore_api::state::{Automation, Board, Config, Miner, Round, Treasury};
use serde_json::{json, Map, Value};
use std::mem::size_of;

/// offset_of without nightly: take a zeroed value and measure the field's address.
macro_rules! offsets {
    ($ty:ty, $( $field:ident ),+ $(,)?) => {{
        let v: $ty = bytemuck::Zeroable::zeroed();
        let base = &v as *const $ty as usize;
        let mut m = Map::new();
        m.insert("size".into(), json!(size_of::<$ty>()));
        let mut f = Map::new();
        $(
            f.insert(
                stringify!($field).into(),
                json!(&v.$field as *const _ as usize - base),
            );
        )+
        m.insert("fields".into(), Value::Object(f));
        Value::Object(m)
    }};
}

fn main() {
    let out = json!({
        "note": "Offsets are within the struct. Steel prefixes each account with an 8-byte discriminator, so add 8 when reading raw account data.",
        "programId": ore_api::ID.to_string(),
        "entropyProgramId": entropy_api::ID.to_string(),
        "mint": MINT_ADDRESS.to_string(),
        "tokenDecimals": TOKEN_DECIMALS,
        "oneOre": ONE_ORE,
        "splitAddress": SPLIT_ADDRESS.to_string(),
        "executorAddress": EXECUTOR_ADDRESS.to_string(),
        "checkpointFee": CHECKPOINT_FEE,
        "seeds": {
            "automation": String::from_utf8_lossy(AUTOMATION),
            "board": String::from_utf8_lossy(BOARD),
            "config": String::from_utf8_lossy(CONFIG),
            "miner": String::from_utf8_lossy(MINER),
            "round": String::from_utf8_lossy(ROUND),
            "treasury": String::from_utf8_lossy(TREASURY),
        },
        "accounts": {
            "Board": offsets!(Board, round_id, start_slot, end_slot, production_cost_ema),
            "Round": offsets!(
                Round, id, deployed, mass, count, slot_hash, expires_at, motherlode,
                rent_payer, rewards, total_vaulted, total_returned_sol, total_miners, top_miner,
            ),
            "Miner": offsets!(
                Miner, authority, auto_return, checkpoint_id, checkpoint_fee, deployed, mass,
                cumulative, round_id, rewards_factor, rewards_sol, refined_ore, rewards_ore,
                last_claim_ore_at, last_claim_sol_at, lifetime_rewards_ore, lifetime_deployed,
                lifetime_rewards_sol,
            ),
            "Automation": offsets!(
                Automation, amount, authority, balance, executor, fee, strategy, mask, reload,
                total_sol_spent, total_ore_earned, conditions,
            ),
            "Config": json!({ "size": size_of::<Config>() }),
            "Treasury": json!({ "size": size_of::<Treasury>() }),
        },
    });
    println!("{}", serde_json::to_string_pretty(&out).unwrap());
}
