# Gali autopilot server

Plays every round of a player's autopilot, app open or closed. It runs on the same Supabase
project as the lobby: an Edge Function (`autopilot`) called every minute by pg_cron.

What it can do is fixed by ORE: it only presses deploy on automations that are open to any
executor and whose spots and amount are set on chain. It can't pick spots, change amounts, or
move anyone's SOL. Each round's deploy pays it 0.00001 SOL from the automation, which covers
the network fee.

## One-time setup (macOS Terminal)

1. Supabase CLI, log in, link the project (ref from the lobby's realtime URL):

       brew install supabase/tap/supabase
       supabase login
       cd ~/Documents/gali-push
       supabase link --project-ref rckvfpwtdyvvvjqqlffn

2. Make the server key (a new wallet only for this job). The public key is printed;
   the secret stays in the file:

       node scripts/executor-key.mjs ~/gali-executor.json

3. Set the secrets. RPC_URL is the Helius mainnet URL in ~/Documents/gali-rpc.txt:

       supabase secrets set EXECUTOR_KEY="$(cat ~/gali-executor.json)" RPC_URL="$(cat ~/Documents/gali-rpc.txt)" CRON_SECRET="$(openssl rand -hex 24 | tee ~/gali-cron-secret.txt)"

4. Deploy the function:

       supabase functions deploy autopilot --no-verify-jwt

5. Send about 0.05 SOL to the public key from step 2. It pays each deploy and is paid back
   by the automation's fee.

6. Schedule it: open the Supabase dashboard, SQL Editor, paste `supabase/sql/autopilot-cron.sql`,
   replace `<PROJECT_REF>` with `rckvfpwtdyvvvjqqlffn` and `<CRON_SECRET>` with the contents of
   `~/gali-cron-secret.txt`, and run it.

7. Check it (one run takes about 50 seconds):

       curl -s -X POST https://rckvfpwtdyvvvjqqlffn.supabase.co/functions/v1/autopilot -H "x-cron-secret: $(cat ~/gali-cron-secret.txt)"

   The reply lists the server key, how many deploys it sent, and any errors.

## Stopping it

    select cron.unschedule('gali-autopilot');

Autopilots keep their SOL in ORE; players can still play while the app is open, and STOP
returns the balance.
