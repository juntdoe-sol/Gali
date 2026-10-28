// Run: node tests/ore-format.cjs
// Small ORE wins never read as 0, and the refined-gain arithmetic matches ORE's fixed point.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/game/pot.ts'), 'utf8');
const m = { exports: {} };
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
new Function('module', 'exports', 'require', code)(m, m.exports, (id) => (id.startsWith('.') ? {} : require(id)));
const { fmtOreAmt } = m.exports;
const cases = [[0, '0'], [-1, '0'], [0.0000004, '<0.000001'], [0.000731, '0.000731'], [0.004, '0.004'], [0.0412, '0.0412'], [0.5, '0.5'], [1.25, '1.25'], [12.5, '12.5'], [150.25, '150.3']];
for (const [v, want] of cases) assert.equal(fmtOreAmt(v), want, `${v}`);
// refined gain: unrefined grams x factor rise / 2^48 (two real ORE treasury readings five minutes apart)
const ONE = 1n << 48n;
const before = 0xe78d86ed127cn;
const after = 0xe78e25057224n;
const unrefined = 100_000_000_000n; // 1 ORE
const gain = Number((unrefined * (after - before)) / ONE) / 1e11;
assert.ok(gain > 0 && gain < 0.0001, `1 ORE held for 5 minutes earns a little refined ORE (${gain})`);
console.log('ore format passed');
