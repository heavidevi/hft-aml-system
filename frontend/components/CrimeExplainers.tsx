import { Panel } from './ui';
import { HBar, Legend } from './mini';
import { usd } from './agents';
import type { Alert, GEdge, Stats } from './types';

const latest = (alerts: Alert[], kind: Alert['kind']) => alerts.find((a) => a.kind === kind);
const Empty = ({ what }: { what: string }) => <p className="text-mute py-6 text-center">No {what} alert yet. Rings appear every few seconds, or trigger one from the control panel.</p>;

function Steps({ items }: { items: { t: string; done: boolean }[] }) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-1 mt-2">
      {items.map((s, i) => (
        <li key={s.t} className={`flex items-center gap-1 text-[10.5px] px-1.5 h-5 border rounded-[2px] ${s.done ? 'border-up/60 text-[#7be0bd]' : 'border-line text-dim'}`}>
          <span className="num">{i + 1}</span>{s.t}
        </li>
      ))}
    </ol>
  );
}

export function Layering({ alerts, edges }: { alerts: Alert[]; edges: GEdge[] }) {
  const a = latest(alerts, 'cycle');
  return (
    <Panel title="Layering: circular flow" right={<span className="chip">bounded DFS, ≤ 6 hops</span>}>
      {!a ? <Empty what="layering" /> : (() => {
        const n = a.accounts.length, R = 62, cx = 150, cy = 84;
        const P = a.accounts.map((_, i) => { const t = (2 * Math.PI * i) / n - Math.PI / 2; return { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) }; });
        const amt = (i: number) => edges.find((e) => e.from === a.accounts[i] && e.to === a.accounts[(i + 1) % n])?.amount;
        return (
          <>
            <svg viewBox="0 0 300 168" className="w-full" role="img" aria-label="Detected loop of accounts">
              <defs><marker id="lm" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#e5484d" /></marker></defs>
              {P.map((p, i) => { const q = P[(i + 1) % n], dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l; const v = amt(i);
                return (<g key={i}>
                  <line x1={p.x + ux * 15} y1={p.y + uy * 15} x2={q.x - ux * 17} y2={q.y - uy * 17} stroke="#e5484d" strokeWidth="2" markerEnd="url(#lm)" className="flow-dash" />
                  <text x={(p.x + q.x) / 2 + uy * -13} y={(p.y + q.y) / 2 + ux * 13} textAnchor="middle" fontSize="9" fill="#d5dbe7" stroke="#141922" strokeWidth="3" paintOrder="stroke" className="num">{v ? usd(v) : ''}</text>
                </g>); })}
              {P.map((p, i) => (<g key={i}><circle cx={p.x} cy={p.y} r="15" fill="#3b82c4" stroke="#a9d4f5" /><text x={p.x} y={p.y + 3} textAnchor="middle" fontSize="8" fill="#fff" className="num">{a.accounts[i]}</text></g>))}
              <text x={cx} y={cy - 2} textAnchor="middle" fontSize="18" fontWeight="700" fill="#d5dbe7" className="num">{n}</text>
              <text x={cx} y={cy + 10} textAnchor="middle" fontSize="8" fill="#8892a6">of max 6 hops</text>
            </svg>
            <p className="text-[11.5px] text-mute">{a.reason}</p>
            <Steps items={[{ t: 'Wire seen', done: true }, { t: 'Edge ≥ $50k', done: true }, { t: 'DFS finds way back', done: true }, { t: 'Score 100', done: a.score >= 100 }, { t: 'Frozen', done: a.frozen.length > 0 }]} />
          </>);
      })()}
    </Panel>
  );
}

export function Smurfing({ alerts, edges }: { alerts: Alert[]; edges: GEdge[] }) {
  const a = latest(alerts, 'structuring');
  const LIMIT = 1_000_000;
  return (
    <Panel title="Smurfing: many small wires" right={<span className="chip">sliding window + monotonic deque</span>}>
      {!a ? <Empty what="smurfing" /> : (() => {
        const into = edges.filter((e) => e.to === a.accounts[0]).slice(0, 10);
        const max = Math.max(LIMIT * 1.15, ...into.map((e) => e.amount));
        const W = 300, H = 130, bw = Math.min(26, (W - 20) / Math.max(1, into.length) - 4), y = (v: number) => H - 16 - (v / max) * (H - 26);
        return (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Wires into the collector account versus the reporting limit">
              <line x1="0" x2={W} y1={y(LIMIT)} y2={y(LIMIT)} stroke="#e0a526" strokeDasharray="4 3" />
              <text x={W - 2} y={y(LIMIT) - 3} textAnchor="end" fontSize="9" fill="#e0a526">reporting limit $10,000</text>
              {into.map((e, i) => <g key={e.from}><rect x={10 + i * (bw + 4)} y={y(e.amount)} width={bw} height={H - 16 - y(e.amount)} fill="#3b82f6" /><text x={10 + i * (bw + 4) + bw / 2} y={H - 4} textAnchor="middle" fontSize="7.5" fill="#8892a6" className="num">{String(e.from).slice(-3)}</text></g>)}
            </svg>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div><div className="lbl">Wires</div><div className="num text-[15px]">{into.length}</div></div>
              <div><div className="lbl">Largest</div><div className="num text-[15px] text-up">{usd(Math.max(0, ...into.map((e) => e.amount)))}</div></div>
              <div><div className="lbl">Total</div><div className="num text-[15px] text-down">{usd(a.amount)}</div></div>
            </div>
            <HBar label="Total vs limit" value={a.amount} max={LIMIT * 5} color="#e5484d" right={`${(a.amount / LIMIT).toFixed(1)}× limit`} />
            <p className="text-[11.5px] text-mute mt-1.5">{a.reason}</p>
            <Steps items={[{ t: 'Each wire < $10k', done: true }, { t: '≥ 5 in window', done: true }, { t: 'Sum ≥ $10k', done: true }, { t: 'Score 100', done: a.score >= 100 }, { t: 'Frozen', done: a.frozen.length > 0 }]} />
          </>);
      })()}
    </Panel>
  );
}

export function Sanctions({ alerts, stats }: { alerts: Alert[]; stats?: Stats }) {
  const hits = alerts.filter((x) => x.kind === 'sanction_hit');
  const sanc = stats?.blocked.filter((b) => b.state === 'sanctioned') ?? [];
  const b = stats?.bloom;
  return (
    <Panel title="Sanctions: blocked at the gate" right={<span className="chip">counting Bloom filter + exact map</span>}>
      <svg viewBox="0 0 300 70" className="w-full" role="img" aria-label="How a sanctioned account is stopped">
        {['Account', 'Hash ×3', 'Bloom counters', 'Exact map', 'Reject'].map((t, i) => (
          <g key={t}><rect x={4 + i * 59} y="14" width="52" height="30" fill={i === 4 ? 'rgba(229,72,77,.18)' : '#1a202b'} stroke={i === 4 ? '#e5484d' : '#35405a'} />
            <text x={30 + i * 59} y="33" textAnchor="middle" fontSize="8" fill="#d5dbe7">{t}</text>
            {i < 4 && <path d={`M${56 + i * 59},29 h7`} stroke="#8892a6" markerEnd="url(#sa)" />}</g>))}
        <defs><marker id="sa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8892a6" /></marker></defs>
        <text x="4" y="62" fontSize="8" fill="#5b6478">Any zero counter = clean in a few ns. All non-zero = confirm in the exact map.</text>
      </svg>
      {b && (
        <div className="space-y-1.5 mt-1">
          <HBar label="Orders and wires checked" value={b.checks} max={b.checks || 1} color="#3b82f6" right={b.checks.toLocaleString()} />
          <HBar label="Rejected at the gate" value={stats!.rejected} max={b.checks || 1} color="#e5484d" right={stats!.rejected.toLocaleString()} />
          <HBar label={`Counters in use (${b.non_zero} / ${b.slots.toLocaleString()})`} value={b.non_zero} max={b.slots} color="#e0a526" right={`${((b.non_zero / b.slots) * 100).toFixed(2)}%`} />
          <div className="flex justify-between text-[11px]"><span className="text-mute">Bloom false positives</span><span className="num text-up">{b.false_positives}</span></div>
        </div>
      )}
      <div className="mt-2 lbl">Sanctioned accounts ({sanc.length}) and hits ({hits.length})</div>
      <Legend items={hits.slice(0, 4).map((h) => ({ c: '#f08c3a', label: `Account ${h.accounts[0]} blocked`, v: `#${h.seq}` }))} />
      {hits.length === 0 && <p className="text-mute text-[11.5px]">No sanction hits yet.</p>}
    </Panel>
  );
}
