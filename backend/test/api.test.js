const test = require('node:test');
const assert = require('node:assert');
const { server } = require('../index.js');

let base;
test.before(async () => { await new Promise((r) => server.listen(0, r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); setTimeout(() => process.exit(0), 50); });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());

test('order matching over REST', async () => {
  await post('/api/reset');
  const a = await post('/api/order', { account: 1, side: 'S', price: 10100, qty: 5 });
  assert.strictEqual(a.status, 'resting');
  const b = await post('/api/order', { account: 2, side: 'B', price: 10100, qty: 5 });
  assert.strictEqual(b.status, 'filled');
  assert.strictEqual(b.trades.length, 1);
  const bad = await post('/api/order', { account: 1, side: 'X', price: 1, qty: 1 });
  assert.strictEqual(bad.ok, false);
  const inj = await post('/api/order', { account: '1\nRESET', side: 'B', price: 1, qty: 1 });
  assert.strictEqual(inj.ok, false);
});

test('cycle scenario freezes accounts', async () => {
  await post('/api/reset');
  const r = await post('/api/scenario/cycle');
  const s = await fetch(`${base}/api/status/${r.accounts[0]}`).then((x) => x.json());
  assert.strictEqual(s.state, 'frozen');
  const alerts = await fetch(`${base}/api/alerts`).then((x) => x.json());
  assert.strictEqual(alerts[0].kind, 'cycle');
});

test('C++ simulation runs, produces trades and flags laundering rings', async () => {
  await post('/api/reset');
  const r = await post('/api/bench', { n: 20000 });
  assert.strictEqual(r.ok, true);
  assert.ok(r.ops_per_sec > 0 && r.trades > 0);
  const st = await fetch(`${base}/api/stats`).then((x) => x.json());
  assert.ok(st.sim.steps >= 20000 && st.algo.cancels > 0);
});

test('smurf scenario raises structuring alert', async () => {
  await post('/api/reset');
  await post('/api/scenario/smurf');
  const alerts = await fetch(`${base}/api/alerts`).then((x) => x.json());
  assert.ok(alerts.some((a) => a.kind === 'structuring'));
});
