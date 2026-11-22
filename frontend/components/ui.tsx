import type { ReactNode } from 'react';

export function Panel({ title, right, children, className = '', bodyClass = '', noPad = false }:
  { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; noPad?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-h"><h2 className="panel-t">{title}</h2>{right && <div className="flex items-center gap-1.5">{right}</div>}</header>
      <div className={`${noPad ? '' : 'panel-b'} ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="lbl">{label}</div>
      <div className="num text-[17px] font-semibold leading-tight truncate" style={{ color }}>{value}</div>
      {sub && <div className="text-[10.5px] text-mute num">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex h-full" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'tab-on' : ''}`} onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}
