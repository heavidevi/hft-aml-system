import { Panel } from './ui';
import { Donut, HBar, Legend, Columns } from './mini';
import { usd } from './agents';
import type { Alert, GNode } from './types';

const KINDS = [{ k: 'cycle', c: '#e5484d', l: 'Layering' }, { k: 'structuring', c: '#e0a526', l: 'Smurfing' }, { k: 'sanction_hit', c: '#f08c3a', l: 'Sanctions' }] as const;

export default function CrimeAnalytics({ alerts, nodes, frozenSeries }: { alerts: Alert[]; nodes: GNode[]; frozenSeries: number[] }) {
  const by = KINDS.map((k) => ({ ...k, n: alerts.filter((a) => a.kind === k.k).length, amt: alerts.filter((a) => a.kind === k.k).reduce((s, a) => s + a.amount, 0) }));
  const maxAmt = Math.max(1, ...by.map((b) => b.amt));
  const chrono = [...alerts].reverse().slice(-40);
  const top = [...nodes].filter((n) => n.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2">
      <Panel title="Alerts by type">
        <div className="flex items-center gap-3">
          <Donut parts={by.map((b) => ({ v: b.n, c: b.c, label: b.l }))} center={<span><b className="text-[15px]">{alerts.length}</b><br /><span className="text-[10px] text-mute">alerts</span></span>} />
          <Legend items={by.map((b) => ({ c: b.c, label: b.l, v: b.n }))} />
        </div>
      </Panel>
      <Panel title="Money flagged by type">
        <div className="space-y-2">{by.map((b) => <HBar key={b.k} label={b.l} value={b.amt} max={maxAmt} color={b.c} right={b.amt ? usd(b.amt) : '–'} />)}</div>
      </Panel>
      <Panel title="Alert timeline" right={<span className="chip">last 40</span>}>
        <svg viewBox="0 0 300 84" className="w-full" role="img" aria-label="Alerts over time by type">
          {KINDS.map((k, r) => <g key={k.k}><line x1="0" x2="300" y1={14 + r * 28} y2={14 + r * 28} stroke="#222a38" /><text x="0" y={10 + r * 28} fontSize="8" fill="#5b6478">{k.l}</text></g>)}
          {chrono.map((a, i) => { const r = KINDS.findIndex((k) => k.k === a.kind); return <circle key={a.seq} cx={8 + (i / Math.max(1, chrono.length - 1)) * 284} cy={14 + r * 28} r="4" fill={KINDS[r].c} />; })}
        </svg>
        <div className="lbl mt-1">Frozen accounts over time</div><Columns data={frozenSeries} color="#6cb4ee" h={30} />
      </Panel>
      <Panel title="Highest risk accounts">
        {top.length === 0 ? <p className="text-mute">No scored accounts in this window.</p> : <div className="space-y-1.5">{top.map((n) => <HBar key={n.account} label={<span className="num">{n.account}</span>} value={n.score} max={100} color={n.state === 'frozen' ? '#6cb4ee' : '#f08c3a'} right={`${n.score} · ${n.state}`} />)}</div>}
      </Panel>
    </div>
  );
}
