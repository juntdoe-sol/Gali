# Gali

A pixel-art mining game for Solana Seeker. Every minute a round opens on a quarry with 25 mining spots. Miners deploy SOL on spots, get their SOL back less a small fee, mine SKR when their spot strikes gold, chat, and tip each other SKR.

Built for **CLOCK IN**, the Solana Mobile hackathon by Radiants (submissions close 9 Oct 2026, 14:59 GMT+8).

## What's in the repo

| Path | What it is |
| --- | --- |
| `programs/gali` | Anchor program: rounds, SOL deploys, reveal, fees and settlement, unclaimed balances and claims, session keys, SKR pools, staking, gear |
| `tests/gali.ts` | Anchor tests (localnet) |
| `scripts/` | Pixel-art generator (`pixel-art.py`), one-command devnet deploy, devnet setup, mock-SKR faucet, crank (reveal, settle, pay out), test runner, IDL generator |
| `target/deploy/gali.so` | Pre-built program, so deploying doesn't need Rust or Anchor (the program keypair is not in git) |
| `app/` | Expo (React Native) Android app: pixel-art quarry (plain Images, no 3D engine), LITE/PRO deploy panel with autopilot, miners chat, SKR tips, Mobile Wallet Adapter |
| `admin/` | Admin web page (Vite + React): money, settings, pause, admin hand-over, rounds, players, chat moderation |
| `supabase/` | Chat server: tables plus the `chat-post` and `chat-admin` edge functions |
| `.github/workflows` | CI: build + test program, optional devnet deploy, release APK |

## How the game works

- **Rounds:** `round_id = unix_time / 60`. No crank opens rounds.
- **Deploy:** put SOL on 1 to 25 spots with `deploy` (min 0.0001 SOL per spot). You can deploy again in the same round on other spots.
- **Reveal:** after a round ends, anyone calls `lock_round`, which commits the draw to a slot 2 slots in the future. About a second later anyone calls `reveal_round`, which must use that slot's hash (or the next one if it was skipped). The result is fixed before anyone can see it, so it can't be re-rolled by retrying or reverting a reveal. The app, the crank and the admin page all do both steps. **The leader of that slot can still influence it; swap in a VRF (Switchboard or ORAO) before mainnet.**
- **Deploy rule:** each player can put SOL on a given spot once per round (the app deploys once per round anyway). This keeps the solo draw exact.
- **SOL never changes hands between players.** Each spot pays a 1% admin fee, and every spot except the gold one also pays `pot_fee_bps` (10%) of what is left. Everything else goes back to the miners on that spot by their share. Covering all 25 spots therefore gets back about 89.5% of the SOL on average (99% on the gold spot, 89.1% on the rest). There is no way to profit in SOL alone: the reward is SKR. Fees go to the treasury wallet (config authority), about 10.5% of volume.
- **SKR per round:** only the gold spot mines. 200 SKR from the Rewards Pool goes to its miners. Each round has 10 **solo spots**, picked in advance from the round id (`solo_mask`: sha256("gali-solo" || round id) and a Fisher-Yates pick; the app shows them as ★). If a solo spot wins, one miner takes all 200 SKR: the owner of a random lamport on that spot, so the odds equal their share. Otherwise the 200 SKR is split by SOL on the spot.
- **Motherlode:** every settled round moves `motherlode_skr` (40 SKR) from the Rewards Pool into the Motherlode Pool; gear sales add more. On a 1-in-625 hit the **whole pool** (as it stands before that round's top-up) is split by SOL on the gold spot, plus 10,000 points each. An early hit pays less, a late one more. Nobody on the gold spot: the pool rolls over.
- **Settle:** anyone calls `settle_pot`: fees to the treasury wallet, the round's SKR (and the Motherlode on a hit) into escrow, then the Motherlode top-up. The Pot keeps the fees, the SKR paid, the solo winner and how many winners were paid, which the app's Rounds tab reads.
- **Claim:** anyone (the app or the crank) calls `claim_pot` for a stake. It credits the returned SOL and any SKR to the player's `Unclaimed` account (`["unclaimed", owner]`, which holds the SOL; the SKR waits in escrow) and adds points (`40 x 25 / spots covered`, x1.25 or x1.5 with staked SKR). The player then calls `claim_rewards` (wallet or session key) to pay it all out: SOL to the wallet, SKR to its SKR account. The app shows the balance as **Unclaimed** with a Claim button. Nothing expires.
- **Session keys:** the wallet approves one `set_session` transaction that also funds a device key (up to 1 SOL). The app then deploys and settles every round without pop-ups. LITE spreads a budget over rounds; PRO has 4 presets, All/Smart block picking and a round count.
- **SKR:** Gali never mints SKR. Gear sales (21 items, 200 to 15,000 SKR) go 30% Motherlode Pool, 40% Rewards Pool, 30% treasury. Anyone can top up with `fund_motherlode` / `fund_rewards`. Staking 5,000 / 50,000 SKR boosts points. Staked SKR can't be unstaked while it boosts the current round, so the same SKR can't boost several wallets in one round. Prices assume 1 SKR ≈ $0.018. At 200 SKR a round plus the 40 SKR Motherlode top-up, the Rewards Pool pays out up to 345,600 SKR a day (only rounds someone plays count), so it needs top-ups until gear sales catch up.
- **Admin:** only the program's upgrade authority can create the config (`init_config`). The config authority can `update_config` (fee capped at 20%, pool shares at 100%), `set_paused` (blocks new deploys and gear sales; settling, claiming and unstaking keep working), `withdraw_treasury` (treasury SKR only; pools and staked SKR have no withdraw path) and hand over admin in two steps (`propose_authority`, `accept_authority`). Use a multisig as the authority before real money.
- **Shared quarry:** everyone on the map sees each other's miners live. Tap the ground to walk, tap a miner to wave (5 emotes), open the chat or send SKR. Positions go over Supabase Realtime broadcast on the `gali-world` channel (the same project as the chat, no tables needed; public channels must be allowed). Payloads are clamped, and a wallet name only shows after the sender signs with its session key and the on-chain Player confirms that session; everyone else shows as a guest. In practice mode, four labelled bots wander the quarry.
- **Pixel art:** all art is original and drawn by `scripts/pixel-art.py` (`python3 scripts/pixel-art.py` rewrites `app/assets/pixel/` and `app/src/pixel/sprites.ts`).
- **Chat + tips:** messages are signed by the player's session key; the edge function checks the signature against the on-chain Player account. Tips are plain SPL transfers from the wallet, then posted to the room with the transaction signature, which the server verifies.
- **Devnet:** uses a mock SKR mint. Real SKR mint: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (verify decimals and token program before switching).
- **Chance:** SOL isn't redistributed, but who mines the SKR is random, so this is still a game of chance. A real-money launch needs age gating and a legal review per market.

## Known limitations (devnet build)

- Randomness is slot-hash based (see Reveal). Use a VRF before real money.
- Leftovers stay in program accounts: each round's pot rent, lamports lost to rounding, SKR rounding dust, and SKR escrowed for a stake nobody claims (the crank claims for everyone, so this needs the crank to be down). There is no sweep instruction yet.
- Upgrading from the earlier build: the Pot account grew. Run the crank until every old round is settled and claimed **before** upgrading; old pots can't be read afterwards. `setup-devnet` also resets `motherlode_skr` to the 40 SKR top-up if it still holds the old 5,000 SKR payout.
- The claim transaction also creates the player's SKR account if needed, so the session key (or wallet) needs about 0.003 SOL for that the first time.
- If the admin wallet holds almost no SOL, a settlement whose fee is below the rent-exempt minimum fails until the wallet is funded. Keep the admin wallet funded.
- The admin can change the pot fee (max 20%) and the SKR reward while a round is open. Use a multisig and a published change policy before real money.
- The SKR mint must not charge transfer fees.

## Run it on your Mac

### 1. Program (devnet)

The quick way, using the pre-built program (needs the [Solana CLI](https://docs.anza.xyz/cli/install), Node 20+, `target/deploy/gali-keypair.json`, and about 4.5 devnet SOL in `~/.config/solana/id.json`):

```bash
solana airdrop 2 -u devnet   # or https://faucet.solana.com (repeat until you have ~4.5 SOL)
bash scripts/deploy-devnet.sh
```

It deploys (or upgrades) the program, creates the mock SKR mint, config and a seeded Rewards Pool (`REWARDS_SEED`; the Motherlode Pool starts empty unless `MOTHERLODE_SEED` is set), and writes `app/src/chain/deployment.json`. The program account keeps about 4.2 SOL as rent. The CLI wallet keeps the right to upgrade the program and becomes the Gali admin (settings, treasury, SOL fees).

To make a browser wallet (Phantom, Solflare) or a multisig the admin instead:

```bash
ADMIN=<wallet address> bash scripts/deploy-devnet.sh
```

Then open the admin page with that wallet, go to **Settings** and click **Accept admin role**. Later hand-overs: `npx ts-node scripts/propose-admin.ts <address>` or the Settings tab.

Then keep rounds moving (reveal, settle, pay every winner even if their app is closed):

```bash
RPC_URL=https://api.devnet.solana.com npm run crank
npx ts-node scripts/faucet.ts <tester-wallet> 50000   # send test SKR
```

To rebuild the program yourself: `anchor build` (Anchor 0.31.1, Solana 2.1.21). `Cargo.lock` is pinned so it builds with Solana's Rust 1.79.

Tests: `anchor test --provider.cluster localnet` (or start `solana-test-validator` and run `node scripts/run-tests.cjs` with `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` set). 16 tests cover rounds, both SKR payout modes, the lock-then-reveal draw, sessions, gear, pools, staking (including the in-round unstake lock) and every admin control. The local validator must load the program as upgradeable (`--upgradeable-program <id> target/deploy/gali.so <wallet>`), since `init_config` checks the upgrade authority.

### 2. Android app

Needs Android Studio (SDK + JDK 17) and a phone with a Solana wallet (Seeker, or any Android phone with Phantom/Solflare set to devnet).

```bash
cd app
npm install --legacy-peer-deps
npx expo prebuild --platform android
npx expo run:android --variant release   # installs on a USB-connected phone
# or build the APK directly:
cd android && ./gradlew assembleRelease  # app/android/app/build/outputs/apk/release/
```

Without `deployment.json` filled in, the app runs in **practice mode**: 2 play SOL and simulated miners.

### 2b. Web test build on Bounded (before the APK)

Live test build: https://galimine.bounded.page

The same app runs in a desktop or mobile browser with Phantom, Solflare or Backpack (the browser extension signs instead of Mobile Wallet Adapter). Everything else is the same: devnet program, session key, autopilot, chat and tips.

```bash
cd app
npm install --legacy-peer-deps
npx bounded login                 # once
npm run deploy:bounded            # builds dist/ and uploads it (private at first)
npx bounded domains slug galimine # the URL name (gali was taken)
npx bounded site privacy public   # let testers open it
```

Testers switch their wallet to devnet (Phantom: Settings → Developer Settings → Testnet Mode, Solana Devnet), get devnet SOL from https://faucet.solana.com, and SKR with `npx ts-node scripts/faucet.ts <wallet> 50000`. Set `EXPO_PUBLIC_RPC_URL` before `npm run deploy:bounded` to use your own RPC instead of the public devnet one.

### 3. Admin page

```bash
cd admin
cp .env.example .env      # set VITE_RPC_URL (use your own RPC for real use)
npm install
npm run dev               # or: npm run build, then host admin/dist anywhere static
```

Connect the admin wallet in Phantom or Solflare (on devnet). Other wallets see a read-only view. Tabs:

- **Overview:** SOL fees earned, treasury, pools, players, rounds, anything waiting to settle.
- **Money:** withdraw treasury SKR, top up a pool.
- **Settings:** game settings and gear prices, pause, admin hand-over.
- **Rounds:** settle stuck rounds, see how each round's SKR was paid.
- **Players**
- **Chat:** hide messages, mute wallets.

It's a static site, so `admin/dist` can go on any static host, including a Bounded app (`npx bounded site deploy ./dist --app-id <id>`). Keep the URL private: the page only reads public chain data and every change still needs the admin wallet's signature.

### 4. Chat server (Supabase)

```bash
supabase init                                      # once, keeps the existing supabase/ files
supabase link --project-ref <ref>
supabase db push                                   # creates the chat and moderation tables
supabase secrets set SKR_MINT=<mint> GALI_PROGRAM_ID=GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV
supabase functions deploy chat-post --no-verify-jwt
supabase functions deploy chat-admin --no-verify-jwt
```

Then put the project URL and anon key in `app/src/chain/chat.json` (the admin page reads the same file). The same settings turn on the shared quarry (Realtime broadcast). Without them the chat shows as offline and the map shows practice bots only; SKR tips still work. Moderation (`chat-admin`) only accepts requests signed by the program's current admin wallet.

## Hackathon checklist

- [x] Android APK (Expo prebuild + Gradle, or the `android-apk` workflow)
- [x] Solana Mobile Stack: Mobile Wallet Adapter for connect, session funding, staking, gear and SKR tips
- [x] Built for the phone: portrait pixel-art quarry that fits between the HUD and the deploy panel, haptics, shake to Smart-pick, daily reminder
- [x] Meaningful Solana use: every deploy, reveal, settlement and claim is a devnet transaction; on-chain leaderboard
- [x] SKR integration: SKR mined each round, Motherlode, SKR-priced gear, staking boosts, tips
- [ ] 3-minute demo video recorded on a device
- [x] Pitch deck
- [ ] Release signing key for the Solana dApp Store (the default build uses the debug keystore)
