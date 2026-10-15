#!/bin/bash
# One-time setup of the Gali autopilot server on Supabase (macOS Terminal).
# Usage: bash autopilot-setup.sh
# Safe to run again: it keeps an existing server key and cron secret.
# Secrets never go on a command line: they pass through a temporary file only you can read.
set -euo pipefail

REPO="${REPO:-$HOME/Documents/gali-push}"
REF="rckvfpwtdyvvvjqqlffn"
KEY="$HOME/gali-executor.json"
SECRET="$HOME/gali-cron-secret.txt"
RPC="$HOME/Documents/gali-rpc.txt"
CRON_SQL="$HOME/gali-autopilot-cron.sql"

say() { printf '\n== %s\n' "$1"; }

# bash autopilot-setup.sh check: run the server once by hand and print its reply
if [ "${1:-}" = "check" ]; then
  H=$(mktemp "$HOME/.gali-h.XXXXXX"); chmod 600 "$H"; trap 'rm -f "$H"' EXIT
  printf 'x-cron-secret: %s\n' "$(tr -d '\n' < "$SECRET")" > "$H"
  echo "Running one pass (about 50 seconds)"
  curl -sS -m 70 -X POST "https://$REF.supabase.co/functions/v1/autopilot" -H @"$H" -H 'content-type: application/json' -d '{}'
  echo
  exit 0
fi

cd "$REPO"
[ -f supabase/functions/autopilot/index.ts ] || { echo "No supabase/functions/autopilot in $REPO. Pull the latest Gali code first."; exit 1; }
[ -s "$RPC" ] || { echo "Missing $RPC (the Helius mainnet URL)."; exit 1; }

say "1/6 Supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  echo "Installing the Supabase CLI with Homebrew"
  brew install supabase/tap/supabase
fi
supabase --version

say "2/6 Log in and link the project"
supabase projects list >/dev/null 2>&1 || supabase login
supabase link --project-ref "$REF"

say "3/6 Server key"
if [ -f "$KEY" ]; then
  echo "Keeping the existing key at $KEY"
else
  node scripts/executor-key.mjs "$KEY"
fi
PUB=$(node -e '
const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).slice(32);
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = BigInt("0x" + Buffer.from(k).toString("hex")), s = "";
while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
for (const b of k) { if (b !== 0) break; s = "1" + s; }
console.log(s);' "$KEY")
echo "Server public key: $PUB"

say "4/6 Secrets"
[ -s "$SECRET" ] || (umask 077; openssl rand -hex 24 > "$SECRET")
ENVF=$(mktemp "$HOME/.gali-autopilot-env.XXXXXX")
chmod 600 "$ENVF"
trap 'rm -f "$ENVF"' EXIT
{
  printf 'EXECUTOR_KEY=%s\n' "$(cat "$KEY")"
  printf 'RPC_URL=%s\n' "$(tr -d '\n' < "$RPC")"
  printf 'CRON_SECRET=%s\n' "$(tr -d '\n' < "$SECRET")"
} > "$ENVF"
supabase secrets set --env-file "$ENVF"
rm -f "$ENVF"

say "5/6 Deploy the function"
supabase functions deploy autopilot --no-verify-jwt

say "6/6 The every-minute schedule"
(umask 077; sed -e "s/<PROJECT_REF>/$REF/g" -e "s/<CRON_SECRET>/$(tr -d '\n' < "$SECRET")/g" supabase/sql/autopilot-cron.sql > "$CRON_SQL")
pbcopy < "$CRON_SQL"
cat <<EOF

Done on this side. Three things left:

  1. The schedule SQL is on your clipboard (also saved in $CRON_SQL).
     Supabase dashboard > SQL Editor > paste > Run.

  2. Send about 0.05 SOL to the server key:
     $PUB
     It pays each deploy's network fee and gets 0.00001 SOL back from every autopilot round it plays.

  3. Test one run (takes about 50 seconds):
     bash $REPO/scripts/autopilot-setup.sh check
EOF
