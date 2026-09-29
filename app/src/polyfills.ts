// Web: browsers already have TextEncoder and crypto.getRandomValues, and the Buffer
// global that web3.js/Anchor want is set by src/chain/polyfill-web.ts, which runs first
// inside the lazily loaded chain chunk. So the startup bundle only needs a bare `process`.
// Android/iOS use polyfills.native.ts instead.
const g = globalThis as unknown as { process?: { env: Record<string, string> } };
if (!g.process) g.process = { env: {} };

export {};
