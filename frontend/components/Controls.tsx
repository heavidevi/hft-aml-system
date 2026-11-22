'use client';
import { useState, type ReactNode } from 'react';
import { API_URL } from '../lib/store';
import { compact } from './agents';
import type { Bench } from './types';

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  const [o, setO] = useState(open);
  return (
    <div className="border-b border-line last:border-0">
      <button className="w-full flex items-center justify-between h-8 px-3 panel-t hover:text-ink" onClick={() => setO(!o)} aria-expanded={o}>{title}<span className="text-dim">{o ? '−' : '+'}</span></button>
      {o && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

export default function Controls({ running, onRunning, bench, onBench }: { running: boolean; onRunning: (r: boolean) => void; bench: Bench | null; onBench: (b: Bench) => void }) {
  const [speed, setSpeed] = useState(100);
  const [crime, setCrime] = useState(5);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [acct, setAcct] = useState('1');
  const [side, setSide] = useState<'B' | 'S'>('B');
  const [price, setPrice] = useState('100.00');
  const [qty, setQty] = useState('5');
  const [target, setTarget] = useState('');

  const call = async (method: 'GET' | 'POST', path: string, body?: object) => {
    try {
      const r = await fetch(API_URL + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
      const j = await r.json();
      const bad = j.ok === false;
      setMsg({ ok: !bad, t: bad ? String(j.reason || j.error) : j.state ? `${j.account}: ${j.state}, score ${j.score}` : `${j.status ?? 'done'}${j.trades?.length ? `, ${j.trades.length} trade(s)` : ''}` });
      return j;
    } catch { setMsg({ ok: false, t: 'Backend unreachable' }); }
  };
  const sim = (r: boolean, steps: number, sec: number) => {
    setSpeed(steps); setCrime(sec); onRunning(r);
    call('POST', '/api/sim', { running: r, steps, launderEvery: sec ? steps * 10 * sec : 0, pace: Math.max(1, Math.round(steps * 1.2)) });
  };
  const runBench = async () => { setBusy(true); const j = await call('POST', '/api/bench', { n: 1000000 }); setBusy(false); if (j?.ok) onBench(j); };
  const Seg = <T extends string | number>({ v, set, opts }: { v: T; set: (x: T) => void; opts: [T, string][] }) => (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${opts.length}, 1fr)` }}>{opts.map(([o, l]) => <button key={String(o)} className={`btn !rounded-none first:!rounded-l-[3px] last:!rounded-r-[3px] ${v === o ? 'btn-on' : ''}`} onClick={() => set(o)}>{l}</button>)}</div>
  );

  return (
    <section className="panel overflow-hidden">
      <header className="panel-h"><h2 className="panel-t">Control panel</h2>{msg && <span className={`chip ${msg.ok ? 'text-up border-up/50' : 'text-down border-down/50'} max-w-[180px] truncate`}>{msg.t}</span>}</header>
      <Section title="Market">
        <button className={`btn w-full ${running ? '' : 'btn-pri'}`} onClick={() => sim(!running, speed, crime)}>{running ? 'Pause market' : 'Resume market'}</button>
        <div className="lbl">Speed (engine steps per 100 ms)</div>
        <Seg v={speed} set={(s) => sim(running, s, crime)} opts={[[20, 'Slow'], [100, 'Normal'], [500, 'Fast']]} />
        <button className="btn w-full" onClick={() => call('POST', '/api/reset')}>Reset engine state</button>
      </Section>
      <Section title="Financial crime">
        <div className="lbl">Criminal rings appear every</div>
        <Seg v={crime} set={(s) => sim(running, speed, s)} opts={[[0, 'Off'], [3, '3 s'], [5, '5 s'], [12, '12 s']]} />
        <div className="lbl">Trigger now</div>
        <div className="grid grid-cols-3 gap-1.5">
          <button className="btn" onClick={() => call('POST', '/api/scenario/smurf')}>Smurfing</button>
          <button className="btn" onClick={() => call('POST', '/api/scenario/cycle')}>Loop</button>
          <button className="btn" onClick={() => call('POST', '/api/scenario/sanction')}>Sanction</button>
        </div>
      </Section>
      <Section title="Engine stress test">
        <button className="btn btn-pri w-full" disabled={busy} onClick={runBench}>{busy ? 'Running in C++…' : 'Run 1,000,000 steps'}</button>
        {bench && <div className="grid grid-cols-2 gap-2 num text-[12px] border border-line p-2 bg-panel2"><div><div className="lbl">Messages / s</div><b className="text-up text-[14px]">{compact(bench.ops_per_sec)}</b></div><div><div className="lbl">Per message</div><b className="text-[14px]">{bench.avg_ns_per_op} ns</b></div><div><div className="lbl">Orders</div>{compact(bench.orders)}</div><div><div className="lbl">Trades</div>{compact(bench.trades)}</div></div>}
      </Section>
      <Section title="Manual order" open={false}>
        <div className="grid grid-cols-2 gap-1.5"><label className="lbl">Account<input className="field mt-0.5" value={acct} onChange={(e) => setAcct(e.target.value)} /></label><label className="lbl">Quantity<input className="field mt-0.5" value={qty} onChange={(e) => setQty(e.target.value)} /></label></div>
        <label className="lbl block">Price ($)<input className="field mt-0.5" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-1.5"><button className={`btn ${side === 'B' ? 'btn-up' : ''}`} onClick={() => setSide('B')}>Buy</button><button className={`btn ${side === 'S' ? 'btn-down' : ''}`} onClick={() => setSide('S')}>Sell</button></div>
        <button className={`btn w-full ${side === 'B' ? 'btn-up' : 'btn-down'}`} onClick={() => call('POST', '/api/order', { account: Number(acct), side, price: Math.round(Number(price) * 100), qty: Number(qty) })}>Submit {side === 'B' ? 'buy' : 'sell'} order</button>
      </Section>
      <Section title="Account admin" open={false}>
        <input className="field" placeholder="Account number" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Account number" />
        <div className="grid grid-cols-3 gap-1.5">
          <button className="btn" onClick={() => call('GET', `/api/status/${Number(target)}`)}>Status</button>
          <button className="btn" onClick={() => call('POST', '/api/sanction', { account: Number(target) })}>Sanction</button>
          <button className="btn" onClick={() => call('POST', '/api/unfreeze', { account: Number(target) })}>Unfreeze</button>
        </div>
      </Section>
    </section>
  );
}
