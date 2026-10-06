const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (!process.argv[2]) {
  const req = createRequire(path.join(root, 'app/package.json'));
  // Same gitignore matcher used by EAS; no network/upload required.
  const ignore = req('ignore')().add(readFileSync(path.join(root, '.easignore'), 'utf8'));
  for (const file of ['app/.env', 'app/.env.production', 'admin/.env.local', '.env', 'app/.bounded/credentials', 'app/.bounded/app.json', 'app/bounded.json', 'app/credentials.json', 'app/local.keypair.json', 'target/deploy/gali-keypair.json', 'app/dist-android/bundle.js', 'app/dist-preview/a.js', 'app/dist/web.js', 'admin/dist/a.js', 'app/android/app/build/a.apk', 'app/ios/build/a', 'app/signing.keystore', 'app/node_modules/a/index.js', 'app/rpc-backend/.env', 'video/out/a.mp4']) {
    assert.ok(ignore.ignores(file), `EAS must exclude ${file}`);
  }
  for (const file of ['app/package.json', 'app/package-lock.json', 'app/eas.json', 'app/app.json', 'app/index.ts', 'app/src/chain/client.ts', 'app/src/game/idl.json', 'app/assets/icon.png', 'app/.env.example', 'target/idl/gali.json', 'programs/gali/src/lib.rs']) {
    assert.ok(!ignore.ignores(file), `EAS must retain ${file}`);
  }
  const eas = JSON.parse(readFileSync(path.join(root, 'app/eas.json')));
  for (const config of Object.values(eas.build)) assert.equal(config.env?.EXPO_PUBLIC_RPC_URL, undefined);
  assert.equal(eas.build['apk-live'].env.EXPO_PUBLIC_NETWORK, 'mainnet');
  assert.ok(readFileSync(path.join(root, 'admin/src/main.tsx'), 'utf8').includes("if (import.meta.env.DEV && import.meta.env.VITE_BURNER === '1')"));
  console.log('EAS exclusions, required source, RPC config and burner guard passed');
} else {
  const walk = dir => readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = walk(process.argv[2]).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 0, 'No production JavaScript found');
  for (const file of files) {
    assert.ok(!/UnsafeBurner|unsafe-burner|burner-wallet/.test(readFileSync(file, 'utf8')), 'Production build contains burner wallet');
  }
  console.log('Production artifacts exclude the unsafe burner wallet');
}
