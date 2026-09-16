#!/usr/bin/env bash
# One-command devnet launch for Gali. Run from the repo root on your Mac:
#   bash scripts/deploy-devnet.sh
#   ADMIN=<wallet address> bash scripts/deploy-devnet.sh   # hand the admin role to another wallet
# Needs: the Solana CLI (https://docs.anza.xyz/cli/install), Node 20+, and ~4.5 devnet SOL
# in ~/.config/solana/id.json. That CLI wallet pays for the deploy and keeps the right to
# upgrade the program. The Gali admin (settings, treasury, SOL fees) is that wallet too,
# unless ADMIN is set: then ADMIN is proposed and accepts in the admin page.
# Uses the pre-built program in target/deploy/gali.so, so Rust and Anchor are optional.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC="${RPC_URL:-https://api.devnet.solana.com}"
WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}"
SO=target/deploy/gali.so
KEY=target/deploy/gali-keypair.json
PROGRAM_ID=GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m%s\033[0m\n' "$*"; exit 1; }

command -v solana >/dev/null || die "Install the Solana CLI first: https://docs.anza.xyz/cli/install"
command -v node >/dev/null || die "Install Node 20 or later first."
[ -f "$WALLET" ] || die "No wallet at $WALLET. Create one with: solana-keygen new"
[ -f "$KEY" ] || die "Missing $KEY (the program address key). It is not in git; copy it from your backup."
[ -f "$SO" ] || die "Missing $SO. Build it with: anchor build"
[ "$(solana-keygen pubkey "$KEY")" = "$PROGRAM_ID" ] || die "$KEY is not the key for $PROGRAM_ID"

PAYER=$(solana-keygen pubkey "$WALLET")
say "Deploying from $PAYER on $RPC"
BAL=$(solana balance "$PAYER" -u "$RPC" -k "$WALLET" | awk '{print $1}')
echo "Balance: $BAL SOL"

if solana program show "$PROGRAM_ID" -u "$RPC" -k "$WALLET" >/dev/null 2>&1; then
  say "Program already on devnet: upgrading it"
else
  say "Deploying the program (costs about 4.2 SOL of rent, kept in the program account)"
  awk "BEGIN {exit !($BAL < 4.5)}" && die "Need about 4.5 devnet SOL. Get some at https://faucet.solana.com then run this again."
fi
solana program deploy "$SO" --program-id "$KEY" -u "$RPC" -k "$WALLET"

say "Installing script dependencies"
npm install --no-audit --no-fund

say "Setting up config, mock SKR and pools (safe to re-run)"
RPC_URL="$RPC" ANCHOR_WALLET="$WALLET" npm run -s setup:devnet

if [ -n "${ADMIN:-}" ]; then
  say "Proposing $ADMIN as the Gali admin"
  RPC_URL="$RPC" ANCHOR_WALLET="$WALLET" npx ts-node scripts/propose-admin.ts "$ADMIN"
  ADMIN_WALLET="$ADMIN"
else
  ADMIN_WALLET="$PAYER"
fi

say "Done"
cat <<MSG
Program:  https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet
App:      app/src/chain/deployment.json now points at devnet. Rebuild the APK (see README).
Crank:    keep rounds settling and paying out with
          RPC_URL=$RPC npm run crank
Admin:    cd admin && npm install && npm run dev
          Connect $ADMIN_WALLET in Phantom/Solflare (set to devnet).${ADMIN:+
          Go to Settings and click "Accept admin role" to finish the hand-over.}
MSG
