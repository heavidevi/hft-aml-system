'use client';
import { useRef } from 'react';
import { Panel } from './ui';
import { px } from './agents';
import type { Level } from './types';

function Ladder({ rows, side, prev }: { rows: Level[]; side: 'bid' | 'ask'; prev: Map<string, number> }) {
  const max = Math.max(1, ...rows.map((r) => r.qty));
  const col = side === 'bid' ? 'var(--up)' : 'var(--down)';
  return (
    <>
      {rows.map((r) => {
        const p = prev.get(`${side}${r.price}`);
        const cls = p === undefined ? '' : r.qty > p ? 'flash-up' : r.qty < p ? 'flash-dn' : '';
        return (
          <div key={`${r.price}-${cls ? r.qty : 'x'}`} className={`relative grid grid-cols-3 num text-[11.5px] h-[19px] items-center px-2 ${cls}`}>
            <div className="absolute inset-y-0 right-0" style={{ width: `${(r.qty / max) * 100}%`, background: col, opacity: 0.16 }} />
            <span className="relative" style={{ color: col }}>{px(r.price)}</span>
            <span className="relative text-right">{r.qty}</span>
            <span className="relative text-right text-dim">{r.orders}</span>
          </div>
        );
      })}
    </>
  );
}

function Depth({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const W = 300, H = 90;
  if (!bids.length || !asks.length) return <div style={{ height: H }} />;
  const cum = (l: Level[]) => l.reduce<number[]>((a, x) => [...a, (a[a.length - 1] ?? 0) + x.qty], []);
  const cb = cum(bids), ca = cum(asks), max = Math.max(cb[cb.length - 1], ca[ca.length - 1], 1);
  const prices = [...bids.map((b) => b.price), ...asks.map((a) => a.price)], lo = Math.min(...prices), hi = Math.max(...prices);
  const x = (p: number) => ((p - lo) / Math.max(1, hi - lo)) * W, y = (c: number) => H - (c / max) * (H - 4);
  const area = (l: Level[], c: number[], col: string) => {
    let d = `M${x(l[0].price)},${H}`;
    l.forEach((lv, i) => { d += ` L${x(lv.price)},${y(i ? c[i - 1] : 0)} L${x(lv.price)},${y(c[i])}`; });
    d += ` L${x(l[l.length - 1].price)},${H} Z`;
    return <path d={d} fill={col} fillOpacity="0.28" stroke={col} strokeWidth="1.2" />;
  };
  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: H }} aria-label="Cumulative depth">{area(bids, cb, '#26a17b')}{area(asks, ca, '#e5484d')}</svg>;
}

export default function OrderBook({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const prev = useRef(new Map<string, number>());
  const cur = new Map<string, number>();
  bids.forEach((b) => cur.set(`bid${b.price}`, b.qty)); asks.forEach((a) => cur.set(`ask${a.price}`, a.qty));
  const snap = prev.current; prev.current = cur;
  const spread = bids.length && asks.length ? asks[0].price - bids[0].price : null;
  return (
    <Panel title="Order book" right={<span className="chip num">spread {spread === null ? '–' : px(spread)}</span>} noPad>
      <div className="grid grid-cols-3 px-2 py-1 lbl border-b border-line"><span>Price</span><span className="text-right">Size</span><span className="text-right">Orders</span></div>
      <Ladder rows={[...asks].reverse()} side="ask" prev={snap} />
      <div className="px-2 py-1 border-y border-line bg-panel2 num text-[12px] flex justify-between"><span className="text-mute">Mid</span><b>{bids.length && asks.length ? px((bids[0].price + asks[0].price) / 2) : '–'}</b></div>
      <Ladder rows={bids} side="bid" prev={snap} />
      <div className="px-2 pt-2 pb-1"><div className="lbl mb-1">Cumulative depth</div><Depth bids={bids} asks={asks} /></div>
    </Panel>
  );
}
