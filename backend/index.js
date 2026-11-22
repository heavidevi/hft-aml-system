// Thin Node bridge: spawns the C++ engine and talks to it over stdin/stdout (JSON lines).
// Exposes REST + a WebSocket that pushes live snapshots, trades and AML alerts.
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 4000);
const ENGINE_BIN = process.env.ENGINE_BIN || path.join(__dirname, '..', 'engine', 'build', 'hft_engine');
const ORIGIN = process.env.CORS_ORIGIN || '*';

// ---------------------------------------------------------------- engine link
let clients = new Set();
const broadcast = (msg) => {
  const s = JSON.stringify(msg);
  for (const c of clients) if (c.readyState === 1) c.send(s);
};

function startEngine() {
  const proc = spawn(ENGINE_BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = []; // FIFO: the engine answers commands in order
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    if (line.startsWith('EVT ')) return broadcast({ type: 'alert', alert: JSON.parse(line.slice(4)) });
    if (line.startsWith('RES ')) { const w = waiting.shift(); if (w) w(JSON.parse(line.slice(4))); }
  });
  proc.on('exit', (code) => { console.error(`engine exited (${code})`); process.exit(1); });
  proc.on('error', (e) => { console.error(`cannot start engine at ${ENGINE_BIN}: ${e.message}\nRun: make -C engine`); process.exit(1); });
  return (cmd) => new Promise((resolve) => { waiting.push(resolve); proc.stdin.write(cmd + '\n'); });
}
const engine = startEngine();

// ------------------------------------------------------------------ helpers
const int = (v, name) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 0) throw Object.assign(new Error(`${name} must be a non-negative integer`), { status: 400 });
  return n;
};
let nextOrderId = Date.now() % 1e9;
let scenarioNo = 0;

async function snapshot() {
  const [book, stats, alerts, graph] = await Promise.all([
    engine('STATE 12'), engine('STATS'), engine('ALERTS'), engine('GRAPH 100000 40'),
  ]);
  return { type: 'snapshot', book, stats, alerts, graph };
}
let timer = null;
function scheduleSnapshot() {
  if (timer) return;
  timer = setTimeout(async () => { timer = null; broadcast(await snapshot()); }, 50);
}

async function placeOrder({ account, side, price, qty }) {
  const s = String(side).toUpperCase();
  if (s !== 'B' && s !== 'S') throw Object.assign(new Error('side must be B or S'), { status: 400 });
  const id = nextOrderId++;
  const res = await engine(`ORDER ${id} ${int(account, 'account')} ${s} ${int(price, 'price')} ${int(qty, 'qty')}`);
  if (res.trades && res.trades.length) broadcast({ type: 'trades', trades: res.trades });
  scheduleSnapshot();
  return res;
}
const transfer = (from, to, amount) => engine(`TRANSFER ${int(from, 'from')} ${int(to, 'to')} ${int(amount, 'amount')}`);

const scenarios = {
  async smurf() { // six sub-$10k transfers into one receiver
    const base = 100000 + scenarioNo++ * 100;
    for (let i = 1; i <= 6; i++) await transfer(base + i, base, 900000);
    return { receiver: base };
  },
  async cycle() { // 4-account loop of $60k
    const b = 200000 + scenarioNo++ * 100;
    const ring = [b + 1, b + 2, b + 3, b + 4];
    for (let i = 0; i < 4; i++) await transfer(ring[i], ring[(i + 1) % 4], 6000000);
    return { accounts: ring };
  },
  async sanction() { // sanctioned account tries to trade
    const a = 300000 + scenarioNo++;
    await engine(`SANCTION ${a}`);
    await placeOrder({ account: a, side: 'B', price: 10000, qty: 1 });
    return { account: a };
  },
  async market() { // 60 random orders from accounts 1..20 around 100.00
    for (let i = 0; i < 60; i++) {
      await placeOrder({
        account: 1 + Math.floor(Math.random() * 20),
        side: Math.random() < 0.5 ? 'B' : 'S',
        price: 9990 + Math.floor(Math.random() * 21),
        qty: 1 + Math.floor(Math.random() * 5),
      });
    }
    return { orders: 60 };
  },
};

// ---------------------------------------------------------------------- app
const app = express();
app.use(cors({ origin: ORIGIN }));
app.use(express.json());
const h = (fn) => async (req, res) => {
  try { const out = await fn(req); scheduleSnapshot(); res.json(out); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message }); }
};

app.get('/api/health', (_q, r) => r.json({ ok: true }));
app.get('/api/book', h(() => engine('STATE 12')));
app.get('/api/alerts', h(() => engine('ALERTS')));
app.get('/api/graph', h((q) => engine(`GRAPH ${int(q.query.min ?? 100000, 'min')} ${int(q.query.window ?? 0, 'window')}`)));
app.get('/api/stats', h(() => engine('STATS')));
app.get('/api/signal', h(() => engine('SIGNAL')));
app.get('/api/status/:account', h((q) => engine(`STATUS ${int(q.params.account, 'account')}`)));
app.post('/api/order', h((q) => placeOrder(q.body)));
app.post('/api/cancel', h((q) => engine(`CANCEL ${int(q.body.id, 'id')}`)));
app.post('/api/transfer', h((q) => transfer(q.body.from, q.body.to, q.body.amount)));
app.post('/api/sanction', h((q) => engine(`SANCTION ${int(q.body.account, 'account')}`)));
app.post('/api/unfreeze', h((q) => engine(`UNFREEZE ${int(q.body.account, 'account')}`)));
app.post('/api/reset', h(() => engine('RESET')));
app.post('/api/scenario/:name', h(async (q) => {
  const fn = scenarios[q.params.name];
  if (!fn) throw Object.assign(new Error('unknown scenario'), { status: 404 });
  return { ok: true, ...(await fn()) };
}));

// ------------------------------------------------- live C++ market simulation
// The simulation itself (market makers, HFT bots, retail, criminal rings) runs inside the C++ engine.
// This loop only asks the engine for the next batch of steps and forwards the result to the browsers.
const simCfg = { running: true, steps: 100, launderEvery: 5000, pace: 120 };
let benchRunning = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function simLoop() {
  for (;;) {
    if (!simCfg.running || benchRunning || clients.size === 0) { await sleep(150); continue; }
    const res = await engine(`SIM ${simCfg.steps} ${simCfg.launderEvery} ${simCfg.pace}`);
    broadcast({ type: 'tick', sim: res });
    await sleep(100);
  }
}
let snapBusy = false;
async function snapLoop() {
  for (;;) {
    await sleep(250);
    if (clients.size === 0 || snapBusy) continue;
    snapBusy = true;
    try { broadcast(await snapshot()); } finally { snapBusy = false; }
  }
}

app.get('/api/sim', h(() => ({ ok: true, ...simCfg })));
app.post('/api/sim', h((q) => {
  const b = q.body || {};
  if (b.running !== undefined) simCfg.running = !!b.running;
  if (b.steps !== undefined) simCfg.steps = Math.min(5000, Math.max(1, int(b.steps, 'steps')));
  if (b.launderEvery !== undefined) simCfg.launderEvery = int(b.launderEvery, 'launderEvery');
  if (b.pace !== undefined) simCfg.pace = Math.max(1, int(b.pace, 'pace'));
  return { ok: true, ...simCfg };
}));
// Stress test: the C++ engine runs n simulation steps back-to-back, no I/O in between.
app.post('/api/bench', h(async (q) => {
  const n = Math.min(2000000, Math.max(1000, int(q.body.n ?? 1000000, 'n')));
  benchRunning = true;
  try {
    const sim = await engine(`SIM ${n} 0 25`);
    const result = { ok: true, steps: n, ops: sim.ops, ops_per_sec: sim.ops_per_sec, avg_ns_per_op: sim.avg_ns_per_op, batch_ns: sim.batch_ns, ...sim.batch };
    broadcast({ type: 'bench', result });
    return result;
  } finally { benchRunning = false; }
}));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', async (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.send(JSON.stringify(await snapshot()));
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`backend on :${PORT}  engine=${ENGINE_BIN}`));
  if (process.env.AUTOSTART === '0') simCfg.running = false;
  simLoop();
  snapLoop();
}
module.exports = { app, server, engine };
