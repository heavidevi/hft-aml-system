// Small dependency-free SVG charts used across the dashboard.
import type { ReactNode } from 'react';

const path = (vals: number[], w: number, h: number, lo: number, hi: number) =>
  vals.map((v, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, vals.length - 1)) * w).toFixed(1)},${(h - ((v - lo) / Math.max(1e-9, hi - lo)) * h).toFixed(1)}`).join(' ');

export function Spark({ data, color = '#3b82f6', h = 28, fill = true, min }: { data: number[]; color?: string; h?: number; fill?: boolean; min?: number }) {
  const w = 120;
  if (data.length < 2) return <div style={{ height: h }} className="text-[10px] text-dim">…</div>;
  const lo = min ?? Math.min(...data), hi = Math.max(...data, lo + 1e-9);
  const d = path(data, w, h, lo, hi);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
      {fill && <path d={`${d} L${w},${h} L0,${h} Z`} fill={color} opacity="0.14" />}
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Donut({ parts, size = 74, thick = 11, center }: { parts: { v: number; c: string; label: string }[]; size?: number; thick?: number; center?: ReactNode }) {
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1, r = (size - thick) / 2, C = 2 * Math.PI * r;
  let off = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#222a38" strokeWidth={thick} />
        {parts.map((p) => { const len = (p.v / tot) * C; const el = (
          <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.c} strokeWidth={thick} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} />); off += len; return el; })}
      </svg>
      {center && <div className="absolute inset-0 flex items-center justify-center text-center num text-[11px]">{center}</div>}
    </div>
  );
}

export function Legend({ items }: { items: { c: string; label: string; v?: ReactNode }[] }) {
  return (
    <ul className="space-y-0.5 text-[11px] min-w-0">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-[1px] shrink-0" style={{ background: i.c }} /><span className="text-mute truncate">{i.label}</span>{i.v !== undefined && <span className="num ml-auto">{i.v}</span>}</li>
      ))}
    </ul>
  );
}

export function HBar({ value, max, color = '#3b82f6', label, right }: { value: number; max: number; color?: string; label: ReactNode; right?: ReactNode }) {
  return (
    <div className="text-[11px]">
      <div className="flex justify-between"><span className="text-mute truncate">{label}</span><span className="num">{right}</span></div>
      <div className="h-1.5 bg-[#222a38] rounded-[1px] overflow-hidden"><div className="h-full" style={{ width: `${Math.min(100, (value / Math.max(1e-9, max)) * 100)}%`, background: color }} /></div>
    </div>
  );
}

export function SemiGauge({ value, min = -100, max = 100, size = 150 }: { value: number; min?: number; max?: number; size?: number }) {
  const r = size / 2 - 10, cx = size / 2, cy = size / 2 + 2, t = (value - min) / (max - min), a = Math.PI * (1 - t);
  const pt = (ang: number, rad: number) => `${cx + rad * Math.cos(ang)},${cy - rad * Math.sin(ang)}`;
  const arc = (a0: number, a1: number, c: string) => <path d={`M${pt(a0, r)} A${r},${r} 0 0 1 ${pt(a1, r)}`} fill="none" stroke={c} strokeWidth="9" />;
  return (
    <svg viewBox={`0 0 ${size} ${size / 2 + 14}`} className="w-full max-w-[190px] mx-auto" aria-hidden>
      {arc(Math.PI, Math.PI * 0.6, '#e5484d')}{arc(Math.PI * 0.6, Math.PI * 0.4, '#3a4256')}{arc(Math.PI * 0.4, 0, '#26a17b')}
      <line x1={cx} y1={cy} x2={cx + (r - 14) * Math.cos(a)} y2={cy - (r - 14) * Math.sin(a)} stroke="#d5dbe7" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="4" fill="#d5dbe7" />
    </svg>
  );
}

export function Columns({ data, color = '#3b82f6', h = 56 }: { data: number[]; color?: string; h?: number }) {
  const max = Math.max(1, ...data);
  return (
    <svg viewBox={`0 0 ${Math.max(1, data.length) * 6} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
      {data.map((v, i) => <rect key={i} x={i * 6 + 1} y={h - (v / max) * h} width="4" height={(v / max) * h} fill={color} />)}
    </svg>
  );
}

export function StackedArea({ layers, h = 110 }: { layers: { data: number[]; color: string; label: string }[]; h?: number }) {
  const w = 300, n = Math.max(...layers.map((l) => l.data.length), 2);
  const totals = Array.from({ length: n }, (_, i) => layers.reduce((a, l) => a + (l.data[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  let base = new Array(n).fill(0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height: h }} aria-hidden>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="#222a38" />)}
      {layers.map((l) => {
        const top = base.map((b, i) => b + (l.data[i] ?? 0));
        const x = (i: number) => (i / (n - 1)) * w, y = (v: number) => h - (v / max) * h;
        const d = top.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ' ' +
          [...base].reverse().map((v, i) => `L${x(n - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ' Z';
        base = top;
        return <path key={l.label} d={d} fill={l.color} opacity="0.85" />;
      })}
    </svg>
  );
}
