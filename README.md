# Gali

A cartoon 3D mining game for Solana Seeker. Every minute a round opens on a 5x5 mine. Dig blocks for free, strike gold, climb the on-chain leaderboard, and stake SKR to boost your points.

Built for **CLOCK IN**, the Solana Mobile hackathon by Radiants (submissions close 9 Oct 2026, 14:59 GMT+8).

## What's in the repo

| Path | What it is |
| --- | --- |
| `programs/gali` | Anchor program: rounds, free daily digs, session keys, reveal, claim, SKR staking, gear purchases |
| `tests/gali.ts` | Anchor tests (localnet) |
| `scripts/` | Devnet setup, mock-SKR faucet, optional reveal crank, IDL generator |
| `app/` | Expo (React Native) Android app: React Three Fiber scene, Mobile Wallet Adapter, haptics, shake-to-dig, daily reminders |
| `.github/workflows` | CI: build + test program, optional devnet deploy, release APK |

## How the game works

- **Rounds:** `round_id = unix_time / 60`. No crank opens rounds.
- **Digs:** a dig marks 1–25 blocks for the current round. Each player gets 30 free digs per UTC day (only network fees apply).
- **Reveal:** after a round ends, anyone can call `reveal_round`. The devnet build mixes the latest SlotHashes entry with the round id. **This randomness can be influenced by validators; swap in a VRF (Switchboard or ORAO) before mainnet.**
- **Claim:** permissionless. A win pays `40 × 25 / blocks covered` points (1,000 for a single block). A 1-in-625 motherlode adds 10,000.
- **Session keys:** the player approves one `set_session` transaction in their wallet (Mobile Wallet Adapter / Seed Vault). The app then digs and settles with a device-held key for 24 hours, so each round is one tap with no wallet pop-up.
- **SKR:** stake in the game vault for 1.25x (1,000 SKR) or 1.5x (10,000 SKR) points. SKR can't be minted by the game, so there's no token emission.
- **Shop:** 21 cosmetic items (6 pickaxes, 6 helmets, 5 outfits, 4 pets), bought with SKR via `buy_gear`. 50% of each sale (`motherlode_pool_bps`) goes to the Motherlode Pool and the rest to the treasury.
- **SKR Motherlode:** a 1-in-625 motherlode win also pays `motherlode_skr` (500 SKR) from the pool on `claim`, capped by the pool balance so it can never go insolvent. Anyone can top up the pool with `fund_motherlode`. `npm run setup:devnet` seeds it with `MOTHERLODE_SEED` (default 50,000 test SKR).
- **Devnet:** uses a mock SKR mint. Real SKR mint: `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` (verify decimals and token program before switching).

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
npm run setup:devnet         # creates mock SKR, inits config, writes app/src/chain/deployment.json
npx ts-node scripts/faucet.ts <tester-wallet> 5000   # send test SKR
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

Without `deployment.json` filled in, the app runs in **practice mode** (same game, local results).

## Hackathon checklist

- [x] Android APK (Expo prebuild + Gradle, or the `android-apk` workflow)
- [x] Solana Mobile Stack: Mobile Wallet Adapter for connect, session approval, staking and gear
- [x] Mobile-first: portrait 3D scene, haptics, shake-to-dig, tilt parallax, daily reminder notifications
- [x] Meaningful Solana use: every dig, reveal and claim is a devnet transaction; on-chain leaderboard
- [x] SKR integration: staking boosts + SKR-priced gear
- [ ] 3-minute demo video recorded on a device
- [ ] Pitch deck
- [ ] Release signing key for the Solana dApp Store (the default build uses the debug keystore)
