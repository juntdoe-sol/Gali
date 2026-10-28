# Gali roadmap

What is designed and partly built, but not in the shipped game. Nothing here is live. Anything that ships moves into the README's "Live on mainnet" list.

## In development: the Gali program

`programs/gali` is an Anchor program written for ORE's board. It is tested against `programs/ore-mock` on a local validator (27 tests, `bash scripts/test-local.sh`) and has never run against ORE's live program. It is not deployed.

In the app its screens are behind `EXPO_PUBLIC_FEATURE_GALI_PROGRAM` (off by default): points, streaks, BOOST (SKR staking) and the SKR jackpot. With the flag off the app shows none of them and never sends a Gali program instruction.

What it adds to a round:

- **Jackpot.** ORE adds 0.2 ORE to its motherlode every round and pays the whole pool 1 round in 500, split by SOL on the winning square. When it hits, Gali pays its own jackpot to the same winners, split the same way, plus 10,000 points. That jackpot is Gali's SKR pool and its ORE pool, both filled by gear sales.
- **Record.** `record_ore_round` reads ORE's finished round and the player's miner account and awards points, wins, streaks and XP. It is permissionless, so a player who closed the app still gets credited.

### Rounds go in order (program rules)

ORE's miner account only holds the last round a player deployed in, and Gali keeps one `last_ore_round` per player. Three rules follow:

- **Record before the next deploy.** A round has to be recorded after ORE checkpoints the miner and before the player deploys again. A round missed in that window is forfeit for good: its points can never be credited.
- **Earlier rounds are refused.** Once round N is recorded, any round before N fails with `OreRoundAlreadyRecorded`.
- **Claim jackpots oldest first.** `claim_jackpot` keeps its own `jackpot_round` the same way, so claiming a later motherlode first forfeits an earlier one. Claims also need the miner account to still hold that round, so claim before deploying again.

The tests pin all three as intended behaviour.

Points: `40 x 25 / spots covered` for a win, times 1.25 or 1.5 with staked SKR or ORE (the better boost applies).

### Instructions

Instructions, all in `programs/gali/src/lib.rs`:

- **Game:** `init_player`, `set_session`, `record_ore_round`, `claim_jackpot`
- **Gear:** `buy_gear` (SKR), `buy_gear_ore` (ORE). Priced in USD, converted at an admin-set rate. `motherlode_pool_bps` of an SKR sale (70% at setup) goes to the SKR jackpot pool and `ore_motherlode_bps` of an ORE sale (50% at setup) to the ORE jackpot pool; the rest goes to the treasury
- **Staking:** `stake_skr`, `unstake_skr`, `stake_ore`, `unstake_ore`
- **Pools:** `fund_motherlode` (SKR), `fund_ore` (ORE). Anyone may top up; pools have no withdraw path
- **Admin:** `init_config` (upgrade authority only), `update_config`, `set_token_prices`, `set_paused`, `withdraw_treasury`, `withdraw_treasury_ore`, `propose_authority`, `accept_authority`

Neither SKR nor ORE has a Pyth feed. The admin sets both rates on chain (`set_token_prices`), gear sales refuse a rate older than `price_max_age_secs`, and the app shows a live Jupiter quote beside it.

## Planned

- **Gear as NFTs and a player Market.** Picks, hats, outfits and pets as tradeable NFTs (Metaplex Core planned): Gali drops at set SKR prices, resales between players, a 5% royalty split 70/30 between the SKR pool and the treasury. Cosmetic only: gear never changes odds or payouts. The design exists as notes and pixel art (`scripts/pixel-art.py` draws the gear); there is no Market screen or door in the app.
- **Clans.** Clan ranks by the XP their miners earn. The app shows "coming soon" on the Clans tab.

## Clans (planned)
Level 10 miners create clans of up to 10. Clan Pool vault mines all 25 tiles, pays out ORE weekly, clans rank by ORE mined, shareable clan card. Full plan: docs/CLANS.md
