// Smoke-test the exact transitive API surfaces used by Anchor, Jayson, Xcode and Mocha.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const project of process.argv.slice(2).length ? process.argv.slice(2) : ['.', 'app', 'admin']) {
  const req = createRequire(path.join(root, project, 'package.json'));
  const anchorReq = createRequire(req.resolve('@coral-xyz/anchor'));
  const toml = anchorReq('toml');
  assert.equal(anchorReq('toml/package.json').version, '4.3.0');
  assert.equal(typeof toml.parse, 'function');
  const config = toml.parse(readFileSync(path.join(root, 'Anchor.toml')));
  assert.ok(config.provider);
  assert.throws(() => toml.parse('x=' + '['.repeat(600) + '0' + ']'.repeat(600)));
  try { toml.parse('__proto__.polluted="yes"'); } catch {}
  assert.equal({}.polluted, undefined);
  const jaysonReq = createRequire(req.resolve('jayson'));
  assert.equal(jaysonReq('uuid/package.json').version, '11.1.1');
  const uuid = jaysonReq('uuid');
  assert.ok(uuid.validate(uuid.v4()));
  const Client = req('jayson/lib/client/browser');
  const client = new Client((body, cb) => {
    const request = JSON.parse(body);
    assert.ok(uuid.validate(request.id));
    cb(null, JSON.stringify({jsonrpc: '2.0', id: request.id, result: 'ok'}));
  });
  client.request('health', [], (err, response) => { assert.ifError(err); assert.equal(response.result, 'ok'); });
  assert.equal(typeof req('@solana/web3.js').Connection, 'function');
  if (project === 'app') {
    const xcode = req('xcode');
    const project = xcode.project('fixture.pbxproj');
    project.hash = { project: { objects: {} } };
    assert.match(project.generateUuid(), /^[A-F0-9]{24}$/);
  }
  if (project === '.') {
    const mochaReq = createRequire(req.resolve('mocha'));
    assert.equal(mochaReq('serialize-javascript/package.json').version, '7.0.7');
    const serialize = mochaReq('serialize-javascript');
    assert.deepEqual(Function('return (' + serialize({pattern: /ok/g, date: new Date(0)}) + ')')().date, new Date(0));
    assert.ok(serialize('</script>').includes('\\u003C'));
  }
  console.log(project + ': dependency compatibility passed');
}
