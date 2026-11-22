'use client';
import { useState } from 'react';
import { Tabs } from './ui';
import { KIND_COLOR, kindOf, px, usd } from './agents';
import type { Alert, Stats, TradeRec, WireRec } from './types';

type T = 'alerts' | 'wires' | 'trades' | 'blocked';
const th = 'text-left lbl font-medium px-2 py-1 sticky top-0 bg-panel border-b border-line';
const td = 'px-2 py-[3px] border-b border-line/60 num whitespace-nowrap';
const Who = ({ a }: { a: number }) => <span style={{ color: KIND_COLOR[kindOf(a)] }}>{a}</span>;

export default function BottomPanel({ alerts, wires, trades, stats, onShow }: { alerts: Alert[]; wires: WireRec[]; trades: TradeRec[]; stats?: Stats; onShow: (a: number[]) => void }) {
  const [tab, setTab] = useState<T>('alerts');
  const [open, setOpen] = useState(true);
  return (
    <section className="panel shrink-0" style={{ height: open ? 232 : 34 }}>
      <header className="flex items-center h-[34px] border-b border-line pr-2 shrink-0">
        <Tabs<T> tabs={[{ id: 'alerts', label: `Alerts (${alerts.length})` }, { id: 'wires', label: 'Bank wires' }, { id: 'trades', label: 'Trades' }, { id: 'blocked', label: `Blocked accounts (${stats?.blocked.length ?? 0})` }]} value={tab} onChange={(t) => { setTab(t); setOpen(true); }} />
        <button className="btn ml-auto !h-6" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? 'Collapse' : 'Expand'}</button>
      </header>
      {open && (
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-[11.5px] border-collapse">
            {tab === 'alerts' && (<><thead><tr><th className={th}>#</th><th className={th}>Type</th><th className={th}>Accounts</th><th className={th}>Amount</th><th className={th}>Score</th><th className={th}>Frozen</th><th className={th}>Evidence</th><th className={th} /></tr></thead>
              <tbody>{alerts.map((a) => (<tr key={a.seq} className="hover:bg-panel2">
                <td className={td}>{a.seq}</td>
                <td className={td}><span className="chip" style={{ color: a.kind === 'cycle' ? '#ff9a9d' : a.kind === 'structuring' ? '#f0c75e' : '#f5a96b' }}>{a.kind === 'cycle' ? 'Layering' : a.kind === 'structuring' ? 'Smurfing' : 'Sanction'}</span></td>
                <td className={td}>{a.accounts.map((x, i) => <span key={x}>{i ? ' → ' : ''}<Who a={x} /></span>)}</td>
                <td className={td}>{a.amount ? usd(a.amount) : '–'}</td><td className={td}>{a.score}</td>
                <td className={td}>{a.frozen.length || '–'}</td>
                <td className={`${td} !whitespace-normal font-sans text-mute max-w-[520px]`}>{a.reason}</td>
                <td className={td}><button className="btn !h-5" onClick={() => onShow(a.accounts)}>Show on graph</button></td></tr>))}</tbody></>)}
            {tab === 'wires' && (<><thead><tr><th className={th}>From</th><th className={th}>To</th><th className={th}>Amount</th><th className={th}>Status</th></tr></thead>
              <tbody>{wires.map((w, i) => (<tr key={i}><td className={td}><Who a={w.from} /></td><td className={td}>{w.to ? <Who a={w.to} /> : 'order'}</td><td className={td}>{w.amount ? usd(w.amount) : '–'}</td><td className={`${td} ${w.status === 'ok' ? 'text-up' : 'text-down'}`}>{w.status === 'ok' ? 'Sent' : `Blocked: ${w.note}`}</td></tr>))}</tbody></>)}
            {tab === 'trades' && (<><thead><tr><th className={th}>Price</th><th className={th}>Size</th><th className={th}>Buyer</th><th className={th}>Seller</th></tr></thead>
              <tbody>{trades.map((t, i) => (<tr key={i}><td className={td}>{px(t.price)}</td><td className={td}>{t.qty}</td><td className={td}><Who a={t.buyer} /> <span className="text-dim">{kindOf(t.buyer)}</span></td><td className={td}><Who a={t.seller} /> <span className="text-dim">{kindOf(t.seller)}</span></td></tr>))}</tbody></>)}
            {tab === 'blocked' && (<><thead><tr><th className={th}>Account</th><th className={th}>State</th><th className={th}>Group</th></tr></thead>
              <tbody>{(stats?.blocked ?? []).map((b) => (<tr key={b.account}><td className={td}><Who a={b.account} /></td><td className={`${td} ${b.state === 'frozen' ? 'text-ice' : 'text-warn'}`}>{b.state}</td><td className={td}>{kindOf(b.account)}</td></tr>))}</tbody></>)}
          </table>
        </div>
      )}
    </section>
  );
}
