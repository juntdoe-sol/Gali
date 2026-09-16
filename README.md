# Gali

A cartoon 3D mining game for Solana Seeker. Every minute a round opens on a 5x5 mine. Miners deploy SOL on blocks, split the pot when their block strikes gold, mine SKR every round, chat, and tip each other SKR.

Built for **CLOCK IN**, the Solana Mobile hackathon by Radiants (submissions close 9 Oct 2026, 14:59 GMT+8).

## What's in the repo

| Path | What it is |
| --- | --- |
| `programs/gali` | Anchor program: rounds, SOL deploys, reveal, pot settlement and claims, session keys, SKR pools, staking, gear |
| `tests/gali.ts` | Anchor tests (localnet) |
| `scripts/` | One-command devnet deploy, devnet setup, mock-SKR faucet, crank (reveal, settle, pay out), test runner, IDL generator |
| `target/deploy/gali.so` | Pre-built program, so deploying doesn't need Rust or Anchor (the program keypair is not in git) |
| `app/` | Expo (React Native) Android app: React Three Fiber scene, LITE/PRO deploy panel with autopilot, miners chat, SKR tips, Mobile Wallet Adapter |
| `admin/` | Admin web page (Vite + React): money, settings, pause, admin hand-over, rounds, players, chat moderation |
| `supabase/` | Chat server: tables plus the `chat-post` and `chat-admin` edge functions |
| `.github/workflows` | CI: build + test program, optional devnet deploy, release APK |

## How the game works

- **Rounds:** `round_id = unix_time / 60`. No crank opens rounds.
- **Deploy:** put SOL on 1 to 25 blocks with `deploy` (min 0.0001 SOL per block). You can deploy again in the same round on other blocks.
- **Reveal:** after a round ends, anyone can call `reveal_round`. The devnet build mixes the latest SlotHashes entry with the round id. **Validators can influence this; swap in a VRF (Switchboard or ORAO) before mainnet.**
- **Deploy rule:** each player can put SOL on a given block once per round (the app deploys once per round anyway). This keeps the lucky draw exact.
- **Settle:** anyone calls `settle_pot`. 10% of the SOL pot goes to the treasury wallet (config authority). 200 SKR from the Rewards Pool (plus 5,000 SKR from the Motherlode Pool on a 1-in-625 motherlode) moves into escrow. If nobody covered the winning block, the whole pot is fee and no SKR moves.
- **Claim:** anyone calls `claim_pot` for a stake. The owner gets `their SOL on the gold block / all SOL on it` of the SOL pool, plus points (`40 x 25 / blocks covered`, +10,000 on a motherlode, x1.25 or x1.5 with staked SKR).
- **The round's SKR:** decided 50/50 at reveal. Either it is split like the SOL, or one lucky winner takes all of it. The lucky winner is the owner of a random lamport on the gold block, so the odds equal your share of the SOL there.
- **Session keys:** the wallet approves one `set_session` transaction that also funds a device key (up to 1 SOL). The app then deploys and settles every round without pop-ups. LITE spreads a budget over rounds; PRO has 4 presets, All/Smart block picking and a round count.
- **SKR:** Gali never mints SKR. Gear sales (21 items, 200 to 15,000 SKR) go 30% Motherlode Pool, 40% Rewards Pool, 30% treasury. Anyone can top up with `fund_motherlode` / `fund_rewards`. Staking 5,000 / 50,000 SKR boosts points. Prices assume 1 SKR ≈ $0.018. At 200 SKR a round the Rewards Pool pays out 288,000 SKR a day, so it needs top-ups until gear sales catch up.
- **Admin:** the config authority can `update_config` (fee capped at 20%, pool shares at 100%), `set_paused` (blocks new deploys and gear sales; settling, claiming and unstaking keep working), `withdraw_treasury` (treasury SKR only; pools and staked SKR have no withdraw path) and hand over admin in two steps (`propose_authority`, `accept_authority`). Use a multisig as the authority before real money.
- **Chat + tips:** messages are signed by the player's session key; the edge function checks the signature against the on-chain Player account. Tips are plain SPL transfers from the wallet, then posted to the room with the transaction signature, which the server verifies.
- **Devnet:** uses a mock SKR mint. Real SKR mint: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (verify decimals and token program before switching).
- **Chance:** winners split losers' SOL, so this is a game of chance. A real-money launch needs age gating and a legal review per market.

## Run it on your Mac

### 1. Program (devnet)

The quick way, using the pre-built program (needs the [Solana CLI](https://docs.anza.xyz/cli/install), Node 20+, `target/deploy/gali-keypair.json`, and about 4.5 devnet SOL in `~/.config/solana/id.json`):

```bash
solana airdrop 2 -u devnet   # or https://faucet.solana.com (repeat until you have ~4.5 SOL)
bash scripts/deploy-devnet.sh
```

It deploys (or upgrades) the program, creates the mock SKR mint, config and seeded pools (`MOTHERLODE_SEED`, `REWARDS_SEED`), and writes `app/src/chain/deployment.json`. The program account keeps about 4.2 SOL as rent. The CLI wallet keeps the right to upgrade the program and becomes the Gali admin (settings, treasury, SOL fees).

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

Tests: `anchor test --provider.cluster localnet` (or start `solana-test-validator` and run `node scripts/run-tests.cjs` with `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` set). 15 tests cover rounds, both SKR payout modes, sessions, gear, pools, staking and every admin control.

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

The same app runs in a desktop or mobile browser with Phantom, Solflare or Backpack (the browser extension signs instead of Mobile Wallet Adapter). Everything else is the same: devnet program, session key, autopilot, chat and tips.

```bash
cd app
npm install --legacy-peer-deps
npx bounded login                 # once
npm run deploy:bounded            # builds dist/ and uploads it (private at first)
npx bounded domains slug gali     # optional: pick the URL name
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

Then put the project URL and anon key in `app/src/chain/chat.json` (the admin page reads the same file). Without them the chat shows as offline; SKR tips still work. Moderation (`chat-admin`) only accepts requests signed by the program's current admin wallet.

## Hackathon checklist

- [x] Android APK (Expo prebuild + Gradle, or the `android-apk` workflow)
- [x] Solana Mobile Stack: Mobile Wallet Adapter for connect, session funding, staking, gear and SKR tips
- [x] Built for the phone: portrait 3D scene, haptics, shake to Smart-pick, tilt parallax, daily reminder
- [x] Meaningful Solana use: every deploy, reveal, settlement and claim is a devnet transaction; on-chain leaderboard
- [x] SKR integration: SKR mined each round, Motherlode, SKR-priced gear, staking boosts, tips
- [ ] 3-minute demo video recorded on a device
- [x] Pitch deck
- [ ] Release signing key for the Solana dApp Store (the default build uses the debug keystore)
