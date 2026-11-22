import { useSyncExternalStore } from 'react';
import type { Bench, Raw, SimTick, Snapshot, Stats, Toast, TradeRec, WireRec } from '../components/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_URL = API_URL.replace(/^http/, 'ws') + '/ws';
const N = 120; // samples kept per series
const SERIES = ['ops', 'orders', 'cancels', 'trades', 'checks', 'events', 'dfs', 'wires', 'alerts', 'frozen',
  'rsi', 'macd', 'hist', 'flowImb', 'bookImb', 'mm', 'hft', 'retail', 'crim', 'cancelRatio', 'score'] as const;
type SeriesName = (typeof SERIES)[number];

const push = (a: number[], v: number) => { a.push(v); if (a.length > N) a.shift(); };

class Store {
  online = false;
  snap: Snapshot | null = null;
  tick: SimTick | null = null;
  trades: TradeRec[] = [];
  wires: WireRec[] = [];
  toasts: Toast[] = [];
  bench: Bench | null = null;
  raw: Raw[] = [];
  sigHist: { t: number; e5: number; e13: number; bu: number; bl: number; rsi: number; macd: number; ms: number }[] = [];
  marks: { t: number; dir: 'UP' | 'DOWN' }[] = [];
  private lastDir = '';
  series = Object.fromEntries(SERIES.map((k) => [k, [] as number[]])) as Record<SeriesName, number[]>;
  version = 0;

  private subs = new Set<() => void>();
  private tickSubs = new Set<(t: SimTick, r: Raw) => void>();
  private ws?: WebSocket;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private timer?: ReturnType<typeof setInterval>;
  private dirty = false;
  private toastId = 0;
  private prevStats?: { t: number; s: Stats };
  private prevTick?: { t: number; a: SimTick['agent_orders'] };

  subscribe = (fn: () => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };
  getVersion = () => this.version;
  onTick(fn: (t: SimTick, r: Raw) => void) { this.tickSubs.add(fn); return () => { this.tickSubs.delete(fn); }; }
  dismissToast = (id: number) => { this.toasts = this.toasts.filter((t) => t.id !== id); this.dirty = true; };

  connect() {
    if (this.ws || typeof window === 'undefined') return;
    this.closed = false;
    this.timer = setInterval(() => { if (this.dirty) { this.dirty = false; this.version++; this.subs.forEach((f) => f()); } }, 200);
    const open = () => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      ws.onopen = () => { this.online = true; this.dirty = true; };
      ws.onclose = () => {
        this.online = false; this.dirty = true; this.ws = undefined;
        if (!this.closed) this.retry = setTimeout(open, 1500);
      };
      ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    };
    open();
  }
  disconnect() { this.closed = true; clearTimeout(this.retry); clearInterval(this.timer); this.ws?.close(); this.ws = undefined; }

  private onMessage(m: any) {
    if (m.type === 'snapshot') this.onSnapshot(m as Snapshot);
    else if (m.type === 'tick') this.onTick2(m.sim as SimTick);
    else if (m.type === 'trades') this.trades = [...(m.trades as TradeRec[]).reverse(), ...this.trades].slice(0, 60);
    else if (m.type === 'bench') this.bench = m.result;
    else if (m.type === 'alert') {
      const id = ++this.toastId;
      this.toasts = [{ id, alert: m.alert }, ...this.toasts].slice(0, 4);
      setTimeout(() => this.dismissToast(id), 10000);
    }
    this.dirty = true;
  }

  private onSnapshot(s: Snapshot) {
    const now = performance.now();
    if (this.prevStats) {
      const dt = Math.max(0.05, (now - this.prevStats.t) / 1000), p = this.prevStats.s, c = s.stats;
      push(this.series.orders, (c.orders - p.orders) / dt);
      push(this.series.cancels, (c.algo.cancels - p.algo.cancels) / dt);
      push(this.series.trades, (c.trades - p.trades) / dt);
      push(this.series.checks, (c.bloom.checks - p.bloom.checks) / dt);
      push(this.series.events, (c.algo.events - p.algo.events) / dt);
      push(this.series.dfs, (c.algo.dfs_visits - p.algo.dfs_visits) / dt);
      push(this.series.wires, (c.algo.wires - p.algo.wires) / dt);
      push(this.series.alerts, c.algo.alerts);
      push(this.series.frozen, c.blocked.filter((b) => b.state === 'frozen').length);
      const tr = c.trades - p.trades;
      push(this.series.cancelRatio, tr > 0 ? (c.algo.cancels - p.algo.cancels) / tr : 0);
    }
    this.prevStats = { t: now, s: s.stats };
    this.snap = s;
  }

  private onTick2(t: SimTick) {
    const now = performance.now();
    const prevClose = this.raw.length ? this.raw[this.raw.length - 1].c : t.last_price;
    let h = Math.max(prevClose, t.last_price), l = Math.min(prevClose, t.last_price);
    for (const x of t.recent_trades) { if (x.price > h) h = x.price; if (x.price < l) l = x.price; }
    const r: Raw = { t: Date.now() / 1000, o: prevClose, h, l, c: t.last_price, v: t.batch.volume };
    this.raw.push(r);
    if (this.raw.length > 6000) this.raw.shift();
    this.tick = t;
    this.trades = [...[...t.recent_trades].reverse(), ...this.trades].slice(0, 60);
    this.wires = [...[...t.recent_wires].reverse(), ...this.wires].slice(0, 40);
    push(this.series.ops, t.ops_per_sec);
    if (this.prevTick) {
      const dt = Math.max(0.05, (now - this.prevTick.t) / 1000), a = this.prevTick.a, c = t.agent_orders;
      push(this.series.mm, (c.mm - a.mm) / dt); push(this.series.hft, (c.hft - a.hft) / dt);
      push(this.series.retail, (c.retail - a.retail) / dt); push(this.series.crim, (c.criminal - a.criminal) / dt);
    }
    this.prevTick = { t: now, a: t.agent_orders };
    if (t.signal.ready) {
      const i = t.signal.indicators;
      this.sigHist.push({ t: r.t, e5: i.ema_fast, e13: i.ema_slow, bu: i.boll_upper, bl: i.boll_lower, rsi: i.rsi, macd: i.macd, ms: i.macd_signal });
      if (this.sigHist.length > 6000) this.sigHist.shift();
      if (t.signal.direction !== this.lastDir) {
        this.lastDir = t.signal.direction;
        if (this.lastDir !== 'FLAT') { this.marks.push({ t: r.t, dir: this.lastDir as 'UP' | 'DOWN' }); if (this.marks.length > 60) this.marks.shift(); }
      }
      push(this.series.rsi, t.signal.indicators.rsi);
      push(this.series.macd, t.signal.indicators.macd);
      push(this.series.hist, t.signal.indicators.macd - t.signal.indicators.macd_signal);
      push(this.series.score, t.signal.score);
      push(this.series.bookImb, t.signal.votes[5]?.value ?? 0);
      push(this.series.flowImb, t.signal.votes[6]?.value ?? 0);
    }
    this.tickSubs.forEach((f) => f(t, r));
  }
}

export const store = new Store();
export function useLive() {
  useSyncExternalStore(store.subscribe, store.getVersion, () => 0);
  return store;
}
