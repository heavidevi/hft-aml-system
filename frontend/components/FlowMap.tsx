import type { ReactElement } from 'react';
import { Panel } from './ui';

const NODES = [
  { name: 'Market makers', short: 'MM', x: 80, y: 95, color: '#3b82f6' },
  { name: 'HFT bots', short: 'HFT', x: 250, y: 30, color: '#8f7bf0' },
  { name: 'Retail', short: 'RETAIL', x: 420, y: 95, color: '#8892a6' },
  { name: 'Suspects', short: 'SUSPECT', x: 250, y: 160, color: '#e5484d' },
];

export default function FlowMap({ flow, orders }: { flow: number[][]; orders?: { mm: number; hft: number; retail: number; criminal: number } }) {
  const ord = orders ? [orders.mm, orders.hft, orders.retail, orders.criminal] : [0, 0, 0, 0];
  const max = Math.max(1, ...flow.flatMap((r, b) => r.map((v, s) => (b === s ? 0 : v))));
  const total = flow.flat().reduce((a, b) => a + b, 0) || 1;
  const arrows: ReactElement[] = [];
  flow.forEach((row, b) => row.forEach((v, s) => {
    if (b === s || v < 0.5) return;
    const A = NODES[s], B = NODES[b], dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len, off = 14;
    const sx = A.x + (dx / len) * 30 + nx * off * 0.5, sy = A.y + (dy / len) * 30 + ny * off * 0.5;
    const ex = B.x - (dx / len) * 34 + nx * off * 0.5, ey = B.y - (dy / len) * 34 + ny * off * 0.5;
    const cx = (A.x + B.x) / 2 + nx * off, cy = (A.y + B.y) / 2 + ny * off;
    arrows.push(
      <g key={`${b}-${s}`}>
        <path d={`M${sx},${sy} Q${cx},${cy} ${ex},${ey}`} fill="none" stroke={B.color} strokeOpacity="0.8" strokeWidth={1 + (v / max) * 5} markerEnd="url(#fa)" />
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize="9" fill="#d5dbe7" stroke="#141922" strokeWidth="3" paintOrder="stroke" className="num">{Math.round(v)}</text>
      </g>);
  }));
  return (
    <Panel title="Who buys from whom" right={<span className="chip">lots, decaying window</span>}>
      <svg viewBox="0 0 500 200" className="w-full" role="img" aria-label="Trade flow between participant groups">
        <defs><marker id="fa" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="#8892a6" /></marker></defs>
        {arrows}
        {NODES.map((n, i) => {
          const bought = flow[i].reduce((a, b) => a + b, 0) - flow[i][i], sold = flow.reduce((a, r) => a + r[i], 0) - flow[i][i], net = bought - sold;
          const share = ((flow[i].reduce((a, b) => a + b, 0) + sold) / (2 * total)) * 100;
          return (
            <g key={n.short}>
              <circle cx={n.x} cy={n.y} r={28} fill="#141922" stroke={n.color} strokeWidth="2" />
              <text x={n.x} y={n.y - 1} textAnchor="middle" fontSize="10" fontWeight="700" fill={n.color}>{n.short}</text>
              <text x={n.x} y={n.y + 11} textAnchor="middle" fontSize="8" fill="#8892a6" className="num">{share.toFixed(0)}% vol</text>
              <text x={n.x} y={n.y + 42} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={net >= 0 ? '#26a17b' : '#e5484d'} className="num">{net >= 0 ? 'NET BUY ' : 'NET SELL '}{Math.abs(Math.round(net))}</text>
              <text x={n.x} y={n.y + 53} textAnchor="middle" fontSize="8" fill="#5b6478" className="num">{Math.round(ord[i] / 1000)}k orders</text>
            </g>
          );
        })}
      </svg>
      <p className="text-dim text-[11px]">Arrows run from seller to buyer. HFT bots show many small orders; suspects barely trade, they move money by wire.</p>
    </Panel>
  );
}
