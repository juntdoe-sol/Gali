#!/usr/bin/env bash
# Run the test suite against a throwaway validator.
#
# ORE's program only exists on mainnet, so the tests need the `ore-mock` fixture
# loaded at ORE's address. That has to go in at genesis (--bpf-program), because
# nobody outside ORE holds the keypair for that address. Gali itself is deployed
# normally afterwards, so it has a ProgramData account and init_config's
# upgrade-authority check has something to check.
set -euo pipefail
cd "$(dirname "$0")/.."

LEDGER=${LEDGER:-/tmp/gali-ledger}
RPC=http://127.0.0.1:8899
GALI=GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV
ORE=oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv

pkill -f solana-test-validator 2>/dev/null || true
sleep 1
rm -rf "$LEDGER"

nohup solana-test-validator -r --ledger "$LEDGER" --quiet \
  --bpf-program "$ORE" target/deploy/ore_mock.so \
  > /tmp/gali-validator.log 2>&1 < /dev/null &
disown

for _ in $(seq 1 40); do
  solana -u "$RPC" cluster-version >/dev/null 2>&1 && break
  sleep 1
done

solana -u "$RPC" airdrop 500 >/dev/null
solana -u "$RPC" program deploy target/deploy/gali.so \
  --program-id target/deploy/gali-keypair.json >/dev/null

set +e
ANCHOR_PROVIDER_URL=$RPC ANCHOR_WALLET=${ANCHOR_WALLET:-$HOME/.config/solana/id.json} \
  node scripts/run-tests.cjs
status=$?
echo "tests exited $status; the validator is left running on $RPC for poking at"
exit $status
