#!/usr/bin/env bash
# Second test pass: rebuilds the program with the `fasttime` feature, which sets
# CLOSE_AFTER_SECS and ABANDON_SECS to 0, then runs the suite with GALI_FASTTIME=1
# so the close_round and refund_stake tests actually run instead of skipping.
#
#   bash scripts/test-fasttime.sh
#
# The build it leaves in target/deploy is TEST ONLY. Run `anchor build` (or
# cargo-build-sbf with no features) before deploying anywhere.
set -e
cd "$(dirname "$0")/.."

echo "building programs/gali with --features fasttime (test only)"
cargo-build-sbf -- --features fasttime

echo "running the suite with GALI_FASTTIME=1"
GALI_FASTTIME=1 anchor test --skip-build

echo
echo "reminder: target/deploy/gali.so is a fasttime build. Rebuild before deploying."
