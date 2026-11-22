import { Panel } from './ui';

function Line({ data, color, label }: { data: number[]; color: string; label: string }) {
  const w = 300, h = 54;
  const d = data.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, data.length - 1)) * w).toFixed(1)},${(h / 2 - (Math.max(-1, Math.min(1, v)) * h) / 2).toFixed(1)}`).join(' ');
  const cur = data[data.length - 1] ?? 0;
  return (
    <div>
      <div className="flex justify-between text-[11px]"><span className="text-mute">{label}</span><span className="num" style={{ color: cur >= 0 ? 'var(--up)' : 'var(--down)' }}>{cur >= 0 ? '+' : ''}{cur.toFixed(2)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
        <rect x="0" y="0" width={w} height={h / 2} fill="#26a17b" opacity="0.06" /><rect x="0" y={h / 2} width={w} height={h / 2} fill="#e5484d" opacity="0.06" />
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="#35405a" />
        {data.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

export default function Imbalance({ flow, book }: { flow: number[]; book: number[] }) {
  return (
    <Panel title="Buy / sell pressure" right={<span className="chip">-1 sell ... +1 buy</span>} bodyClass="space-y-3">
      <Line data={flow} color="#e0a526" label="Aggressor flow (who crosses the spread)" />
      <Line data={book} color="#3b82f6" label="Order-book imbalance (top 5 levels)" />
      <p className="text-dim text-[11px]">Above zero: buyers are more aggressive or the bid side is heavier. These two inputs feed the price signal.</p>
    </Panel>
  );
}
