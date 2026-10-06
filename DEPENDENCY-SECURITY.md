# Dependency/build security review

## Verified remediation

- Scoped overrides: Anchor's `toml` 4.3.0 (CommonJS `parse`, Buffer input, actual Anchor.toml compatibility); Jayson's `uuid` 11.1.1 (CommonJS/browser v4); Xcode's `uuid` 11.1.1 (24-character project IDs); Mocha's `serialize-javascript` 7.0.7 (CommonJS serializer, regex/date roundtrip).
- Admin `source-map-js` updated to 1.2.2 within its existing range.
- Registry manifests checked before selecting versions. No Expo/RN downgrade, forced audit fix, or top-level ecosystem migration. Minimum Node 22.13; CI uses Node 22.
- `node scripts/check-dependencies.cjs` tests installed dependency APIs. `node scripts/check-build-hardening.cjs` tests EAS exclusions/source retention. `node scripts/check-build-hardening.cjs admin/dist` checks production output for the unsafe burner, including when built with `VITE_BURNER=1`.
- EAS RPC credential literal removed; `EXPO_PUBLIC_NETWORK=mainnet` retained. Supply a credential-free public proxy URL through the build environment. Public client environment variables are not a secret store.
- Root `.easignore` is intentional: EAS's Git client archives the Git root, and `.easignore` replaces **all** nested `.gitignore` rules. The rules preserve source/assets/IDL, exclude local env/deployment/signing material and generated outputs. Do not switch to `EAS_NO_VCS` without reviewing the changed archive root.
- `python3 scripts/check-secrets.py --artifacts PATH ...` scans tracked files plus explicitly supplied artifacts, reports only paths/rule names. Credential-context rules distinguish secrets from public Solana IDs. Limits: 20,000 files, 64 MiB/file, 512 MiB total; encrypted/encoded secrets and arbitrary binary containers require separate inspection. This is a regression gate, not a comprehensive secret detector.

## Audit results

All counts are npm audit's dependency-node counts, including propagated findings; no audit suppression applied.

| Project | Before | After | Remaining severity |
| --- | ---: | ---: | --- |
| app | 31 | 21 | 18 high, 3 moderate |
| admin | 39 | 30 | 16 high, 8 moderate, 6 low |
| root | 16 | 9 | 6 high, 3 moderate |
| video | 0 | 0 | none |

## Residual advisories — not fixed

- `braces` latest 3.0.3 remains affected by GHSA-vfj7-8cjw-p6xm. Used by Metro/Mocha tooling; no patched published version found. Treat repository/file patterns as trusted; avoid processing untrusted projects in build workers.
- `node-forge` latest 1.4.0 remains affected by GHSA-86w9-cpqp-85rv. Expo tooling still includes it. No patched published version found; build/update signing verification remains a residual risk.
- `bigint-buffer` latest 1.1.5 remains affected by GHSA-3gc7-fjrx-p6mg in its native implementation. Actual Android and admin source maps resolve `bigint-buffer/dist/browser.js`, a pure-JS conversion without native bindings. This limits client reachability, **not** the installed-package advisory or Node/native risk in root tooling.
- `stream-json` 1.9.1 remains under Jayson. Patched 3.6+ changes to ESM and incompatible paths; overriding would break Jayson's `stream-json/streamers/StreamValues` and `stream-json/utils/Verifier` CommonJS imports. Actual Android/admin source maps contain only Jayson's browser client and request generator, no `stream-json`. Node/server consumers remain affected.
- `elliptic` latest 6.6.1 remains affected by GHSA-848j-6mx2-7j84. Admin's polyfill plugin is configured for `buffer` only; actual admin source maps contain neither `elliptic` nor `crypto-browserify`. Installed dev dependency findings remain.

Local checks passed: root/app TypeScript, admin TypeScript + production build, Android Hermes export, web export, dependency API tests, EAS rules, source/artifact credential gate. Existing Metro package-export warnings and Vite chunk-size warning remain. Native APK signing, device behavior, live RPC, and onchain operations were not tested.

## Existing artifacts and incident follow-up

A first Android export reused stale Metro output containing the historical credential although tracked sources were clean. `expo export --clear` produced a clean Android artifact; CI explicitly clears caches. Existing `app/dist-android` and old export/cache artifacts were not deleted. Never publish them; rebuild with cleared caches and run the artifact gate. Historical credentials still require owner-controlled revocation/rotation and review of prior uploads/history; removing a literal is not revocation. No external deployment, funds operation, or key rotation performed.
