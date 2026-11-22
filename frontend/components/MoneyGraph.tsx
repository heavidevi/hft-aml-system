'use client';
// Interactive money-flow graph: canvas + d3-force layout. Wheel/pinch zoom, drag to pan, drag nodes, filters, search.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { API_URL } from '../lib/store';
import { kindOf, usd } from './agents';
import type { Alert, GEdge, GNode } from './types';

type Role = 'collector' | 'mule' | 'ring' | null;
type N = SimulationNodeDatum & { id: number; state: GNode['state']; score: number; role: Role; r: number };
type L = { source: N; target: N; amount: number; hot: 'loop' | 'fan' | null };
type Mode = 'all' | 'suspicious' | 'frozen' | 'sanctioned';

const FILL = { ok: '#1f7a8c', frozen: '#3b82c4', sanctioned: '#f08c3a' } as const;

export default function MoneyGraph({ alerts, focus }: { alerts: Alert[]; focus: { accounts: number[]; n: number } | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<Mode>('all');
  const [win, setWin] = useState(200);
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [full, setFull] = useState(false);
  const [sel, setSel] = useState<N | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [counts, setCounts] = useState({ n: 0, e: 0 });
  const [raw, setRaw] = useState<{ nodes: GNode[]; edges: GEdge[] }>({ nodes: [], edges: [] });

  const S = useRef({
    nodes: new Map<number, N>(), links: [] as L[], sim: null as Simulation<N, undefined> | null,
    t: { x: 0, y: 0, k: 1 }, w: 800, h: 520, dirty: true, hover: null as N | null, hoverLink: null as L | null,
    drag: null as { node?: N; px: number; py: number; moved: boolean } | null, ptrs: new Map<number, { x: number; y: number }>(), pinch: 0,
    query: '', key: '', hl: new Set<number>(), hlUntil: 0, active: new Set<N>(), fitted: false, placed: false,
  });

  // ---- roles from alerts
  const roles = useMemo(() => {
    const m = new Map<number, Role>(), loop = new Set<string>(), fan = new Set<number>();
    alerts.forEach((a) => {
      if (a.kind === 'cycle') a.accounts.forEach((x, i) => { m.set(x, 'ring'); loop.add(`${x}>${a.accounts[(i + 1) % a.accounts.length]}`); });
      if (a.kind === 'structuring') { m.set(a.accounts[0], 'collector'); fan.add(a.accounts[0]); }
    });
    raw.edges.forEach((e) => { if (fan.has(e.to) && !m.has(e.from)) m.set(e.from, 'mule'); });
    return { m, loop, fan };
  }, [alerts, raw.edges]);

  // ---- poll the (existing) graph endpoint with a larger window
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`${API_URL}/api/graph?min=0&window=${win}`);
        const j = await r.json();
        if (!stop && j.nodes) setRaw(j);
      } catch { /* backend offline */ }
    };
    load();
    const id = setInterval(load, 1000);
    return () => { stop = true; clearInterval(id); };
  }, [win]);

  const fit = useCallback((ids?: number[]) => {
    const s = S.current;
    const list = [...s.nodes.values()].filter((n) => !ids || ids.includes(n.id));
    if (!list.length) return;
    const xs = list.map((n) => n.x ?? 0), ys = list.map((n) => n.y ?? 0);
    const x0 = Math.min(...xs) - 40, x1 = Math.max(...xs) + 40, y0 = Math.min(...ys) - 40, y1 = Math.max(...ys) + 40;
    const k = Math.min(3, Math.max(0.15, Math.min(s.w / (x1 - x0), s.h / (y1 - y0))));
    s.t = { k, x: s.w / 2 - ((x0 + x1) / 2) * k, y: s.h / 2 - ((y0 + y1) / 2) * k };
    s.dirty = true;
  }, []);

  // ---- rebuild graph model when data / filter changes
  useEffect(() => {
    const s = S.current;
    const keep = (n: GNode) => mode === 'all' ? true : mode === 'frozen' ? n.state === 'frozen' : mode === 'sanctioned' ? n.state === 'sanctioned' : (n.state !== 'ok' || roles.m.has(n.account));
    const ids = new Set(raw.nodes.filter(keep).map((n) => n.account));
    raw.edges.forEach((e) => { if (mode === 'suspicious' && (roles.loop.has(`${e.from}>${e.to}`) || roles.fan.has(e.to))) { ids.add(e.from); ids.add(e.to); } });
    const nodes: N[] = [];
    raw.nodes.forEach((g) => {
      if (!ids.has(g.account)) return;
      let n = s.nodes.get(g.account);
      if (!n) { n = { id: g.account, state: g.state, score: g.score, role: null, r: 7, x: (Math.random() - 0.5) * 200, y: (Math.random() - 0.5) * 200 }; s.nodes.set(g.account, n); }
      n.state = g.state; n.score = g.score; n.role = roles.m.get(g.account) ?? null; n.r = n.role === 'collector' ? 10 : n.role ? 8 : 6;
      nodes.push(n);
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: L[] = [];
    raw.edges.forEach((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      if (a && b) links.push({ source: a, target: b, amount: e.amount, hot: roles.loop.has(`${e.from}>${e.to}`) ? 'loop' : roles.fan.has(e.to) ? 'fan' : null });
    });
    s.links = links;
    s.active = new Set(nodes);
    setCounts({ n: nodes.length, e: links.length });
    const key = nodes.map((n) => n.id).sort().join(',') + '|' + links.length;
    if (!s.sim) {
      s.sim = forceSimulation<N>([]).velocityDecay(0.35).force('charge', forceManyBody<N>().strength(-95)).force('collide', forceCollide<N>().radius((n) => n.r + 4))
        .force('x', forceX<N>(0).strength(0.035)).force('y', forceY<N>(0).strength(0.035)).force('center', forceCenter(0, 0)).on('tick', () => { s.dirty = true; });
      s.sim.force('link', forceLink<N, L>([]).distance(48).strength(0.45));
    }
    s.sim.nodes(nodes);
    (s.sim.force('link') as ReturnType<typeof forceLink<N, L>>).links(links);
    if (key !== s.key) { s.key = key; if (!paused) s.sim.alpha(0.5).restart(); if (!s.fitted && nodes.length > 1) { s.fitted = true; setTimeout(() => fit(), 600); } }
    s.dirty = true;
  }, [raw, mode, roles, paused, fit]);

  useEffect(() => { const s = S.current; if (!s.sim) return; if (paused) s.sim.stop(); else s.sim.alphaTarget(0).restart(); }, [paused]);

  useEffect(() => {
    if (!focus || !focus.accounts.length) return;
    const s = S.current;
    s.hl = new Set(focus.accounts); s.hlUntil = Date.now() + 6000;
    setMode('all');
    setTimeout(() => fit(focus.accounts), 250);
  }, [focus, fit]);

  useEffect(() => { S.current.query = query.trim(); S.current.dirty = true; }, [query]);

  // ---- drawing
  useEffect(() => {
    const s = S.current, c = cv.current!, ctx = c.getContext('2d')!;
    const ro = new ResizeObserver(() => {
      const r = wrap.current!.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (!s.placed) { s.placed = true; s.t = { x: r.width / 2, y: r.height / 2, k: 1 }; }
      s.w = r.width; s.h = r.height; c.width = r.width * dpr; c.height = r.height * dpr; c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; s.dirty = true;
    });
    ro.observe(wrap.current!);
    let raf = 0;
    const shape = (n: N, x: number, y: number, r: number) => {
      ctx.beginPath();
      if (n.role === 'collector') ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else if (n.role === 'mule') { ctx.moveTo(x, y - r - 1); ctx.lineTo(x + r + 1, y); ctx.lineTo(x, y + r + 1); ctx.lineTo(x - r - 1, y); ctx.closePath(); }
      else if (n.role === 'ring') { for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i; ctx.lineTo(x + (r + 1) * Math.cos(a), y + (r + 1) * Math.sin(a)); } ctx.closePath(); }
      else ctx.arc(x, y, r, 0, Math.PI * 2);
    };
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const pulse = Date.now() < s.hlUntil;
      if (!s.dirty && !pulse) return;
      s.dirty = false;
      const dpr = window.devicePixelRatio || 1, { x: tx, y: ty, k } = s.t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, s.w, s.h);
      ctx.fillStyle = '#10141c'; ctx.fillRect(0, 0, s.w, s.h);
      // faint grid that moves with the view
      ctx.strokeStyle = '#171d28'; ctx.lineWidth = 1; const g = 40 * k;
      for (let x = ((tx % g) + g) % g; x < s.w; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, s.h); ctx.stroke(); }
      for (let y = ((ty % g) + g) % g; y < s.h; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(s.w, y); ctx.stroke(); }
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);
      for (const l of s.links) {
        const a = l.source, b = l.target; if (a.x == null || b.x == null) continue;
        const dx = b.x! - a.x!, dy = b.y! - a.y!, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const col = l.hot === 'loop' ? '#e5484d' : l.hot === 'fan' ? '#e0a526' : '#3a4560';
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = (l.hot ? 1.8 : 0.8 + Math.min(1.6, Math.log10(Math.max(1, l.amount / 100)) * 0.35)) / Math.sqrt(k);
        if (s.hoverLink === l) ctx.lineWidth *= 2;
        const x1 = a.x! + ux * a.r, y1 = a.y! + uy * a.r, x2 = b.x! - ux * (b.r + 3), y2 = b.y! - uy * (b.r + 3);
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const ah = 5 / Math.sqrt(k); ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - ux * ah - uy * ah * 0.5, y2 - uy * ah + ux * ah * 0.5); ctx.lineTo(x2 - ux * ah + uy * ah * 0.5, y2 - uy * ah - ux * ah * 0.5); ctx.closePath(); ctx.fill();
        if (k > 1.1 && (l.hot || k > 1.8)) { ctx.fillStyle = '#c3cadb'; ctx.font = `${9 / k}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.fillText(usd(l.amount), (a.x! + b.x!) / 2, (a.y! + b.y!) / 2 - 2 / k); }
      }
      const q = s.query;
      for (const n of s.nodes.values()) {
        if (n.x == null || !s.active.has(n)) continue;
        const x = n.x!, y = n.y!, match = q && String(n.id).includes(q), isHl = pulse && s.hl.has(n.id);
        shape(n, x, y, n.r); ctx.fillStyle = FILL[n.state]; ctx.fill();
        ctx.lineWidth = (match || isHl || sel === n ? 2.4 : n.role === 'ring' ? 1.8 : 1) / Math.sqrt(k);
        ctx.strokeStyle = match || sel === n ? '#ffffff' : isHl ? '#f5d76e' : n.role === 'ring' ? '#e5484d' : n.state === 'frozen' ? '#a9d4f5' : '#0d1017'; ctx.stroke();
        if (isHl) { ctx.beginPath(); ctx.arc(x, y, n.r + 5 + 4 * Math.sin(Date.now() / 150), 0, Math.PI * 2); ctx.strokeStyle = 'rgba(245,215,110,.55)'; ctx.stroke(); }
        if (n.state === 'frozen') { ctx.fillStyle = 'rgba(13,16,23,.45)'; ctx.save(); shape(n, x, y, n.r); ctx.clip(); for (let i = -n.r * 2; i < n.r * 2; i += 4) { ctx.fillRect(x + i, y - n.r, 1.2, n.r * 2); } ctx.restore(); }
        if (k > 0.8 || match || s.hover === n) { ctx.fillStyle = '#d5dbe7'; ctx.font = `${10 / Math.max(k, 0.8)}px ui-monospace,monospace`; ctx.textAlign = 'center'; ctx.fillText(String(n.id), x, y + n.r + 11 / Math.max(k, 0.8)); }
      }
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [sel]);

  // ---- interaction
  useEffect(() => {
    const c = cv.current!, s = S.current;
    const pos = (e: PointerEvent | WheelEvent) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const toG = (p: { x: number; y: number }) => ({ x: (p.x - s.t.x) / s.t.k, y: (p.y - s.t.y) / s.t.k });
    const nodeAt = (p: { x: number; y: number }) => { const g = toG(p); let best: N | null = null, bd = 1e9; for (const n of s.sim?.nodes() ?? []) { const d = Math.hypot((n.x ?? 0) - g.x, (n.y ?? 0) - g.y); if (d < n.r + 4 / s.t.k && d < bd) { best = n; bd = d; } } return best; };
    const linkAt = (p: { x: number; y: number }) => { const g = toG(p); let best: L | null = null, bd = 5 / s.t.k; for (const l of s.links) { const ax = l.source.x ?? 0, ay = l.source.y ?? 0, bx = l.target.x ?? 0, by = l.target.y ?? 0, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((g.x - ax) * dx + (g.y - ay) * dy) / (dx * dx + dy * dy || 1))); const d = Math.hypot(ax + t * dx - g.x, ay + t * dy - g.y); if (d < bd) { bd = d; best = l; } } return best; };
    const zoom = (f: number, p = { x: s.w / 2, y: s.h / 2 }) => { const k = Math.min(6, Math.max(0.1, s.t.k * f)), g = toG(p); s.t = { k, x: p.x - g.x * k, y: p.y - g.y * k }; s.dirty = true; };
    (c as any).__zoom = zoom;
    const wheel = (e: WheelEvent) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015), pos(e)); };
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId); const p = pos(e); s.ptrs.set(e.pointerId, p);
      if (s.ptrs.size === 2) { const [a, b] = [...s.ptrs.values()]; s.pinch = Math.hypot(a.x - b.x, a.y - b.y); s.drag = null; return; }
      const n = nodeAt(p); s.drag = { node: n ?? undefined, px: p.x, py: p.y, moved: false };
      if (n) { n.fx = n.x; n.fy = n.y; s.sim?.alphaTarget(0.25).restart(); }
    };
    const move = (e: PointerEvent) => {
      const p = pos(e); if (s.ptrs.has(e.pointerId)) s.ptrs.set(e.pointerId, p);
      if (s.ptrs.size === 2) { const [a, b] = [...s.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (s.pinch) zoom(d / s.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); s.pinch = d; return; }
      if (s.drag) {
        const dx = p.x - s.drag.px, dy = p.y - s.drag.py; if (Math.abs(dx) + Math.abs(dy) > 2) s.drag.moved = true;
        if (s.drag.node) { const g = toG(p); s.drag.node.fx = g.x; s.drag.node.fy = g.y; } else { s.t = { ...s.t, x: s.t.x + dx, y: s.t.y + dy }; s.drag.px = p.x; s.drag.py = p.y; s.dirty = true; }
        return;
      }
      const n = nodeAt(p), l = n ? null : linkAt(p);
      if (n !== s.hover || l !== s.hoverLink) { s.hover = n; s.hoverLink = l; s.dirty = true; }
      c.style.cursor = n ? 'pointer' : l ? 'help' : 'grab';
      if (n) setTip({ x: p.x, y: p.y, text: `${n.id} · ${kindOf(n.id)}\n${n.state}${n.role ? ' · ' + n.role : ''} · score ${n.score}` });
      else if (l) setTip({ x: p.x, y: p.y, text: `${l.source.id} → ${l.target.id}\n${usd(l.amount)} total` });
      else setTip(null);
    };
    const up = (e: PointerEvent) => {
      s.ptrs.delete(e.pointerId); s.pinch = 0;
      const d = s.drag; s.drag = null;
      if (d?.node) { d.node.fx = null; d.node.fy = null; s.sim?.alphaTarget(0); if (!d.moved) setSel(d.node); }
      else if (d && !d.moved) setSel(null);
    };
    const dbl = (e: MouseEvent) => { const p = pos(e as unknown as PointerEvent), n = nodeAt(p); if (n) fit([n.id]); else zoom(1.8, p); };
    c.addEventListener('wheel', wheel, { passive: false }); c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up); c.addEventListener('dblclick', dbl);
    c.addEventListener('pointerleave', () => setTip(null));
    return () => { c.removeEventListener('wheel', wheel); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); c.removeEventListener('dblclick', dbl); };
  }, [fit]);

  useEffect(() => { if (!full) return; const k = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [full]);
  const z = (f: number) => (cv.current as any)?.__zoom?.(f);
  const info = useMemo(() => {
    if (!sel) return null;
    const inn = raw.edges.filter((e) => e.to === sel.id), out = raw.edges.filter((e) => e.from === sel.id);
    return { inn: inn.reduce((a, e) => a + e.amount, 0), out: out.reduce((a, e) => a + e.amount, 0), ni: inn.length, no: out.length, al: alerts.filter((a) => a.accounts.includes(sel.id)) };
  }, [sel, raw.edges, alerts]);

  const Chip = ({ m, label }: { m: Mode; label: string }) => <button className={`btn ${mode === m ? 'btn-on' : ''}`} onClick={() => setMode(m)}>{label}</button>;
  return (
    <section className={`panel ${full ? 'fixed inset-3 z-40 !bg-panel shadow-2xl' : ''}`}>
      <header className="flex items-center gap-1.5 px-2 min-h-[36px] border-b border-line flex-wrap py-1">
        <h2 className="panel-t pl-1 mr-1">Money-flow graph</h2>
        <Chip m="all" label="All" /><Chip m="suspicious" label="Suspicious" /><Chip m="frozen" label="Frozen" /><Chip m="sanctioned" label="Sanctioned" />
        <input className="field !w-28" placeholder="Find account" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find account" />
        <label className="flex items-center gap-1.5 text-[11px] text-mute">Last <input type="range" min={20} max={400} step={20} value={win} onChange={(e) => setWin(+e.target.value)} className="w-20 accent-[#3b82f6]" aria-label="Number of recent wires" /><span className="num w-8">{win}</span>wires</label>
        <span className="ml-auto chip num">{counts.n} nodes · {counts.e} edges</span>
        <button className="btn" onClick={() => z(1.3)} aria-label="Zoom in">+</button><button className="btn" onClick={() => z(1 / 1.3)} aria-label="Zoom out">−</button>
        <button className="btn" onClick={() => fit()}>Fit</button>
        <button className={`btn ${paused ? 'btn-on' : ''}`} onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? 'Layout paused' : 'Pause layout'}</button>
        <button className="btn" onClick={() => setFull((f) => !f)}>{full ? 'Close (Esc)' : 'Full screen'}</button>
      </header>
      <div ref={wrap} className="relative" style={{ height: full ? 'calc(100vh - 90px)' : 540 }}>
        <canvas ref={cv} className="absolute inset-0 touch-none" aria-label="Interactive money-flow graph" />
        {counts.n === 0 && <div className="absolute inset-0 grid place-items-center text-mute pointer-events-none">No wires in this window yet. Criminal rings appear every few seconds.</div>}
        {tip && <div className="absolute z-10 pointer-events-none bg-[#0b0e14] border border-line px-2 py-1 text-[11px] num whitespace-pre rounded-[2px]" style={{ left: Math.min(tip.x + 12, S.current.w - 150), top: tip.y + 12 }}>{tip.text}</div>}
        <div className="absolute left-2 bottom-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-mute bg-panel/90 border border-line px-2 py-1 rounded-[2px]">
          <span><span className="text-down">━</span> circular flow</span><span><span className="text-amber">━</span> fan-in</span>
          <span>■ collector</span><span>◆ mule</span><span>⬢ ring member</span><span><span style={{ color: FILL.ok }}>●</span> normal</span><span><span style={{ color: FILL.frozen }}>●</span> frozen</span><span><span style={{ color: FILL.sanctioned }}>●</span> sanctioned</span>
        </div>
        <div className="absolute right-2 bottom-2 text-[10.5px] text-dim bg-panel/90 border border-line px-2 py-1 rounded-[2px]">wheel: zoom · drag: pan · drag node: move · double-click: focus</div>
        {sel && info && (
          <aside className="absolute right-2 top-2 w-60 bg-panel border border-line rounded-[3px] p-2.5 text-[11.5px] space-y-1.5">
            <div className="flex justify-between items-center"><b className="num text-[13px]">{sel.id}</b><button className="btn !h-5 !px-1.5" onClick={() => setSel(null)} aria-label="Close">✕</button></div>
            <div className="text-mute">{kindOf(sel.id)} · <span style={{ color: FILL[sel.state] }}>{sel.state}</span>{sel.role ? ` · ${sel.role}` : ''}</div>
            <div className="grid grid-cols-2 gap-2 num"><div><div className="lbl">Received</div>{usd(info.inn)} <span className="text-dim">({info.ni})</span></div><div><div className="lbl">Sent</div>{usd(info.out)} <span className="text-dim">({info.no})</span></div></div>
            <div className="lbl">Risk score</div><div className="num">{sel.score}</div>
            {info.al.slice(0, 2).map((a) => <p key={a.seq} className="text-mute border-t border-line pt-1">#{a.seq} {a.kind.replace('_', ' ')}: {a.reason}</p>)}
          </aside>
        )}
      </div>
    </section>
  );
}
