# Read-only Solana RPC backend — staged, not deployed

## Verified discovery

- Supplied `id09310c7577ad7aa143936fb5` is malformed. Read-only `npx bounded apps list --json` independently resolved `galiisland` to `09310c7577ad7aa143936fb5`.
- App protocol `realtime_offchain`, runtime target `development`; Bounded control-plane environment `production` (not Solana's network). Domain listing confirms `https://galiisland.bounded.page`.
- `apps inspect` returns `409 no_policy_lineage`: static site has no successfully deployed backend policy. Functions and secret inventories are empty. `deploy status` reports `freshDeploySafe: true`; preflight reports `would_likely_admit`. These are discovery results, not deployment receipts.
- Existing `app/policy.json` is unrelated spend-cap demo scaffolding; left untouched. This directory isolates a minimal function-only policy. Re-inspect immediately before release; merge rather than replace if another backend has since appeared.

## Boundary

Fixed mainnet Helius origin. Server secret `HELIUS_RPC_KEY`; no wallet/signing keys. Eight explicitly validated read methods. POST JSON only; no batches, notifications, arbitrary targets, redirects, transaction submission, program scans, historical signature search, or arbitrary encodings. At most 10 signatures, 8 KiB requests, 256 KiB responses, 8-second upstream deadline. Provider diagnostics suppressed. `cors: app` permits configured app origins; CORS is not authentication.

Bounded public ingress documents **120 requests/minute per app+function per Cloudflare location**, before execution, returning 429/Retry-After. This is not a global or per-user quota; distributed abuse can still spend credits. Configure provider budget limits and monitor usage before release. Do not move this handler to an unthrottled HTTP host. No misleading process-local limiter.

`src/chain/light.ts` routes only those reads through `EXPO_PUBLIC_RPC_READ_URL` when explicitly configured for mainnet. Signed transactions stay on credential-free `EXPO_PUBLIC_RPC_URL`/wallet transport. Devnet remains separate. Public Solana transaction transport can rate-limit; no live transaction was submitted during verification.

## Local checks

From `app/`:

```sh
node rpc-backend/rpc.test.mjs
node rpc-backend/client.test.cjs
npx tsc --noEmit
```

All passed. Actual Helius read-only smoke passed via the local handler with the pre-existing key kept solely in process memory: slot, block height, latest blockhash, balance, account info, signature statuses. No credential logged. Local `.env.production` now uses public mainnet transport; old exposed key was NOT revoked.

From `app/rpc-backend/`:

```sh
npx bounded verify --app-id 09310c7577ad7aa143936fb5 --json
```

Passed `PROVEN`: public-function declaration only. This does not prove handler security or hosted execution.

## Release sequence — requires parent/user approval first

Do not run root `app/policy.json`. Do not use `--create`, source sync, or local wallet-key authentication. Commands below run from `app/rpc-backend/`:

```sh
npx bounded apps inspect --app-id 09310c7577ad7aa143936fb5 --json
npx bounded functions list --app-id 09310c7577ad7aa143936fb5 --json
npx bounded deploy preflight --app-id 09310c7577ad7aa143936fb5 --json
npx bounded verify --app-id 09310c7577ad7aa143936fb5 --json
# User creates a replacement Helius key; enter it in this hidden terminal prompt.
npx bounded secret put HELIUS_RPC_KEY --app-id 09310c7577ad7aa143936fb5
npx bounded deploy policy.json --app-id 09310c7577ad7aa143936fb5 --no-source
# Ensure the function has a deployed code pin (explicit standalone deployment).
npx bounded functions deploy rpc --entry functions/rpc.mjs --app-id 09310c7577ad7aa143936fb5 --auth true --public --method POST --cors app --timeout 10 --secret HELIUS_RPC_KEY
npx bounded apps inspect --app-id 09310c7577ad7aa143936fb5 --json
npx bounded functions list --app-id 09310c7577ad7aa143936fb5 --json
npx bounded secret list --app-id 09310c7577ad7aa143936fb5 --json
```

If authentication needs refreshing, use Bounded's web login. Never paste credentials into chat/argv, read an owner wallet key, or deploy the previously exposed provider key as a replacement.

Use the exact `publicUrls.rpc` returned by `functions list`, not an assumed hostname. Verify hosted POST `getSlot` succeeds; `sendTransaction`, `getProgramAccounts`, batches, oversized requests fail; configured-origin preflight succeeds. Verify native throttling carefully under an approved bounded load test; local unit tests cannot validate Bounded's edge enforcement. Then set `EXPO_PUBLIC_RPC_READ_URL` to the verified public URL, rebuild/publish the frontend under the parent's release plan. Do not enable the client URL before backend readiness. After replacement traffic is confirmed, revoke the old key with the provider; existing published bundles/history remain exposed until rotation. No secret storage, deploy, provider revocation, or published-site change was performed here.

## Realtime discovery

`src/chain/chat.json` has empty `url` and `anonKey`. Repository `.env.production` has only `EXPO_PUBLIC_NETWORK` and `EXPO_PUBLIC_RPC_URL`; process environment has no Supabase/world/realtime variable names. No linked Supabase project configuration was found. Existing `supabase/` has chat SQL migrations and chat-post/chat-admin functions, not an enabled hosted project.

World broadcast reads `EXPO_PUBLIC_WORLD_URL` and `EXPO_PUBLIC_WORLD_KEY` (or chat config). Need user-provided existing Supabase project and its **public anon/publishable key**, approved channel policies, then two-browser delivery verification. Never ship service-role/admin credentials. Broadcast scores are ephemeral peer claims, not durable authoritative scores. Bounded realtime would require a separate authenticated client/policy migration; this RPC policy does not enable scores. No service provisioned or claimed active.
