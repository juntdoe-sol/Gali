# Security fixes, 28 Oct 2026: how to roll them out

These commits fix the findings in the 28 Oct security audit. Server changes and the new app depend on each other,
so roll out in this order. Every step names who runs it and where.

## 1. Today, before anything else

- [ ] Revoke the old Helius key (it is in public git history, commit `a7b6acc`) in the Helius dashboard, make a new
      one, and put it in the Bounded secret `HELIUS_RPC_KEY` for the `rpc`, `rpc2` and `games` functions.
- [ ] Set monthly spending caps on Helius and Alchemy.
- [ ] On expo.dev, open the `production` environment variables and check `EXPO_PUBLIC_RPC_URL`. It must hold a URL
      without a key (for example `https://api.mainnet-beta.solana.com`), because every `EXPO_PUBLIC_` value ships
      inside the APK.

## 2. Supabase (from the repo folder in macOS Terminal)

First make the arena ticket key (once, on your Mac; keep the file out of the repo):

```sh
node scripts/ticket-key.mjs ~/gali-ticket-key.txt
```

It prints a `npx supabase secrets set TICKET_KEY=...` line to run, and an `EXPO_PUBLIC_TICKET_KEY=...` value. Add that
value on expo.dev as a `production` environment variable (plain text, it is public), and use it for the web build
in step 4. Without it the arena falls back to the old smallest-id host.

```sh
npx supabase secrets set DM_SECRET=<a new random value of 32+ characters>
npx supabase secrets set SOLANA_RPC=<a mainnet RPC URL>
npx supabase functions deploy play
npx supabase functions deploy dm
npx supabase functions deploy chat-post
npx supabase functions deploy chat-admin
npx supabase functions deploy autopilot
npx supabase functions delete social-moments
npx supabase secrets unset ZERNIO_API_KEY ZERNIO_ACCOUNTS ZERNIO_LIVE MOMENTS_OFF
```

`DM_SECRET` is now required. If it was never set, everyone's message sign-in ends once and the app asks again.
Then revoke the API key in the Zernio dashboard.

In the Supabase SQL Editor, run in this order:

1. `supabase/sql/remove-social-moments.sql`
2. `supabase/sql/arcade-ledger.sql`
3. `supabase/sql/signed-reports.sql`, after the new web build (step 4) is live. From then on, apps older than
   1.7 stop saving KOs, wins, check-ins and chat history; the game itself keeps working for them.
4. `supabase/sql/verified-scores.sql`, right after signed-reports.sql. From then on the boards use only XP and
   points the server worked out itself. Every wallet's current total is kept, frozen, as its starting point;
   the day, week, month and year boards count verified gains only.

## 3. Arcade house (Bounded, macOS Terminal)

See `app/rpc-backend/GAMES.md`. Add the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` secrets and redeploy `games`.
Until both are set, the tables show "not ready" and take no stakes.

## 4. Web

Build and deploy from `app/` with the ticket key's public half:

```sh
EXPO_PUBLIC_TICKET_KEY=<value from step 2> npm run deploy:bounded
```

(with the same `EXPO_PUBLIC_NETWORK`, `EXPO_PUBLIC_RPC_READ_URL`, `EXPO_PUBLIC_WORLD_URL` and `EXPO_PUBLIC_WORLD_KEY`
values as the `apk-live` profile in `app/eas.json`). Then test: connect a wallet, sign the one-time sign-in,
deploy and claim one round and check it appears on the TODAY board, open the arcade, chat in the lobby, and join
the arena from two browsers.

## 5. APK

Build 1.7.0 (versionCode 22) with `npx eas-cli build -p android --profile apk-live` and test on a Seeker and on a
non-Seeker phone with Phantom.

## 6. Before the Gali program is ever deployed

1. Tests: pushing to `main` runs the `program` workflow, which builds both programs from source and runs
   `tests/gali.ts` on a local validator. It must pass. To run it on your Mac instead: install the Solana CLI
   2.1.21 and Anchor 0.31.1, build with `cargo-build-sbf` for both programs, then `bash scripts/test-local.sh`.
   The `target/deploy/*.so` files in the repo are old builds; always rebuild first.
2. Make a Squads v4 multisig at app.squads.so with at least 2 of 3 members on separate devices.
3. Deploy, then run `init_config` with the deploying key (it needs the upgrade authority's signature).
4. Run `RPC_URL=<mainnet RPC> npx ts-node scripts/multisig-handover.ts <multisig address>`. It proposes the
   multisig's vault as config authority, creates the Squads proposal for the vault to accept it, and prints the
   command that moves the upgrade authority to the vault. Approve and execute the proposal in Squads first, then
   run that command.

Deploys made after this point: the app records each finished round and claims a jackpot in the same transaction
as the next deploy, so a player who keeps mining no longer forfeits them.

## Limits that remain

- The arena host is now chosen among players with a server ticket (an ORE miner account, which costs real SOL),
  by a half-hourly hash. Someone with many funded miner wallets has more chances at the seat, and a host can still
  run matches unfairly; the damage stays inside the arena's capped XP and the 60 KOs and 60 wins a day.
- Bonus XP (fights, quests, moles) is still reported by the app; the server caps it at 600 a day per wallet.
  Live-round XP and all points are worked out by the server from ORE's accounts.
- A live round only scores if the app or the autopilot reports it before the player's next deploy, the same
  window ORE's own miner account has.
- Old mutex accounts from the previous arcade design hold about 0.0009 SOL each and stay where they are.
