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

## 3. Arcade house (Bounded, macOS Terminal)

See `app/rpc-backend/GAMES.md`. Add the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` secrets and redeploy `games`.
Until both are set, the tables show "not ready" and take no stakes.

## 4. Web

Deploy the new web build to galiisland and test: connect a wallet, sign the one-time sign-in, deploy and claim
one round, open the arcade, chat in the lobby.

## 5. APK

Build 1.7.0 (versionCode 21) with `npx eas-cli build -p android --profile apk-live` and test on a Seeker and on a
non-Seeker phone with Phantom.

## 6. Before the Gali program is ever deployed

The program fixes need `anchor test` (or the `program` CI workflow) to pass, and the upgrade authority and the
config authority should both sit behind a multisig.

## Not fixed in code

- The arena host is still the smallest player id, so a player who joins with a chosen id can run matches. Matches
  only award capped XP and Brawl points, now limited to 60 KOs and 60 wins per wallet a day.
- XP, level and points are still reported by each player's own app, so a player can inflate their own numbers
  (never anyone else's).
- Old mutex accounts from the previous arcade design hold about 0.0009 SOL each and stay where they are.
