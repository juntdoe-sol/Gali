# Arcade house (`games` function)

Tunnel Collapse, Gold Rush Pot and Crash Cart. Stakes are SPL transfers to the house wallet's associated token
account with a `gali1|<game>|<token>|<round>|<choice>` memo. Results and payouts are recorded in Supabase.

## How a round settles

1. Betting closes 30 s into the 40 s round. From 52 s on, any settle call checks that the chain has finalized past
   the close, reads every finalized stake this round owns, works out the result and stores it with
   `arcade_store`. The first call wins; every later call reads the stored result back, so spam, provider lag or a
   changed bankroll can never change it.
2. Each payout batch is a row in `arcade_sends`. It is signed once, its signature stored before sending, and
   resent with the same bytes until it lands. It is signed again only after the old blockhash has expired and the
   old signature never landed. A batch the chain refuses (for example one closed recipient account) is split into
   single transfers so the other players are still paid.
3. Crash Cart only pays a round if the house balance, minus everything it already owes on that token, covers the
   winnings. Otherwise the round is refunded.

Transfers without a `gali1` memo for the table, and stakes below the smallest chip, are ignored: they are never
played or refunded automatically. A round nobody settled within 30 minutes is refused and needs a manual refund.

## Setup

1. Run `supabase/sql/arcade-ledger.sql` once in the Supabase SQL Editor.
2. Copy the project's secret API key (Supabase dashboard, Project Settings, API Keys, a `sb_secret_...` key).
   Never put it in the app.
3. From `app/rpc-backend/` in macOS Terminal, using the id of the Bounded app that already hosts the `games` and
   `rpc` functions (the one behind galiisland-api.bounded.page; `npx bounded functions list` shows it):

```sh
npx bounded secret put SUPABASE_URL --app-id <api-app-id>
npx bounded secret put SUPABASE_SERVICE_KEY --app-id <api-app-id>
npx bounded functions deploy games --entry functions/games.mjs --app-id <api-app-id> --auth true --public --method POST --cors passthrough --timeout 20 --secret HOUSE_KEY --secret GAMES_MASTER --secret HELIUS_RPC_KEY --secret ALCHEMY_RPC_KEY --secret ADMIN_WALLET --secret SUPABASE_URL --secret SUPABASE_SERVICE_KEY
```

`SUPABASE_URL` is `https://rckvfpwtdyvvvjqqlffn.supabase.co`. Until both Supabase secrets are set, every table
reports "not ready" and takes no stakes.

## Tests

From `app/`: `node rpc-backend/games.test.mjs`
