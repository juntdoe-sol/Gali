# Gali

A cartoon 3D mining game for Solana Seeker. Every minute a round opens on a 5x5 mine. Miners deploy SOL on blocks, split the pot when their block strikes gold, mine SKR every round, chat, and tip each other SKR.

Built for **CLOCK IN**, the Solana Mobile hackathon by Radiants (submissions close 9 Oct 2026, 14:59 GMT+8).

## What's in the repo

| Path | What it is |
| --- | --- |
| `programs/gali` | Anchor program: rounds, SOL deploys, reveal, pot settlement and claims, session keys, SKR pools, staking, gear |
| `tests/gali.ts` | Anchor tests (localnet) |
| `scripts/` | Devnet setup, mock-SKR faucet, reveal + settle crank, IDL generator |
| `app/` | Expo (React Native) Android app: React Three Fiber scene, LITE/PRO deploy panel with autopilot, miners chat, SKR tips, Mobile Wallet Adapter |
| `supabase/` | Chat server: `messages` table and the `chat-post` edge function |
| `.github/workflows` | CI: build + test program, optional devnet deploy, release APK |

## How the game works

- **Rounds:** `round_id = unix_time / 60`. No crank opens rounds.
- **Deploy:** put SOL on 1 to 25 blocks with `deploy` (min 0.0001 SOL per block). Several deploys in one round add up.
- **Reveal:** after a round ends, anyone can call `reveal_round`. The devnet build mixes the latest SlotHashes entry with the round id. **Validators can influence this; swap in a VRF (Switchboard or ORAO) before mainnet.**
- **Settle:** anyone calls `settle_pot`. 10% of the SOL pot goes to the treasury wallet (config authority). 25 SKR from the Rewards Pool (plus 5,000 SKR from the Motherlode Pool on a 1-in-625 motherlode) moves into escrow. If nobody covered the winning block, the whole pot is fee and no SKR moves.
- **Claim:** anyone calls `claim_pot` for a stake. The owner gets `their SOL on the gold block / all SOL on it` of the SOL pool and of the escrowed SKR, plus points (`40 x 25 / blocks covered`, +10,000 on a motherlode, x1.25 or x1.5 with staked SKR).
- **Session keys:** the wallet approves one `set_session` transaction that also funds a device key (up to 1 SOL). The app then deploys and settles every round without pop-ups. LITE spreads a budget over rounds; PRO has 4 presets, All/Smart block picking and a round count.
- **SKR:** Gali never mints SKR. Gear sales (21 items, 200 to 15,000 SKR) go 30% Motherlode Pool, 40% Rewards Pool, 30% treasury. Anyone can top up with `fund_motherlode` / `fund_rewards`. Staking 5,000 / 50,000 SKR boosts points. Prices assume 1 SKR ≈ $0.018.
- **Chat + tips:** messages are signed by the player's session key; the edge function checks the signature against the on-chain Player account. Tips are plain SPL transfers from the wallet, then posted to the room with the transaction signature, which the server verifies.
- **Devnet:** uses a mock SKR mint. Real SKR mint: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (verify decimals and token program before switching).
- **Chance:** winners split losers' SOL, so this is a game of chance. A real-money launch needs age gating and a legal review per market.

## Run it on your Mac

### 1. Program (devnet)

```bash
# one-time tools
sh -c "$(curl -sSfL https://release.anza.xyz/v2.1.21/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install 0.31.1 && avm use 0.31.1

solana-keygen new            # skip if you already have ~/.config/solana/id.json
solana config set --url devnet
solana airdrop 2             # or use https://faucet.solana.com

# target/deploy/gali-keypair.json holds the program address
# GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV. Keep it private.
anchor build
anchor deploy --provider.cluster devnet
cp target/idl/gali.json app/src/chain/idl.json

npm install
npm run setup:devnet         # mock SKR, config, seeds pools (MOTHERLODE_SEED, REWARDS_SEED), writes app/src/chain/deployment.json
npx ts-node scripts/faucet.ts <tester-wallet> 50000   # send test SKR
npx ts-node scripts/crank.ts # optional: reveal + settle each round as the authority
```

Local tests: `anchor test --provider.cluster localnet`.

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

### 3. Chat server (Supabase)

```bash
supabase init                                      # once, keeps the existing supabase/ files
supabase link --project-ref <ref>
supabase db push                                   # creates the messages table
supabase secrets set SKR_MINT=<mint> GALI_PROGRAM_ID=GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV
supabase functions deploy chat-post --no-verify-jwt
```

Then put the project URL and anon key in `app/src/chain/chat.json`. Without them the chat shows as offline; SKR tips still work.

## Hackathon checklist

- [x] Android APK (Expo prebuild + Gradle, or the `android-apk` workflow)
- [x] Solana Mobile Stack: Mobile Wallet Adapter for connect, session funding, staking, gear and SKR tips
- [x] Built for the phone: portrait 3D scene, haptics, shake to Smart-pick, tilt parallax, daily reminder
- [x] Meaningful Solana use: every deploy, reveal, settlement and claim is a devnet transaction; on-chain leaderboard
- [x] SKR integration: SKR mined each round, Motherlode, SKR-priced gear, staking boosts, tips
- [ ] 3-minute demo video recorded on a device
- [ ] Pitch deck
- [ ] Release signing key for the Solana dApp Store (the default build uses the debug keystore)
