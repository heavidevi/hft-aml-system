import { Tabs } from './ui';
import type { Bench, SimTick } from './types';
import { compact, ns, px } from './agents';

export type TabId = 'market' | 'crime';
export default function TopBar({ tab, setTab, online, tick, running, bench }:
  { tab: TabId; setTab: (t: TabId) => void; online: boolean; tick: SimTick | null; running: boolean; bench: Bench | null }) {
  const last = tick?.last_price;
  const fair = tick?.fair;
  return (
    <header className="h-11 shrink-0 border-b border-line bg-panel flex items-center px-3 gap-4">
      <div className="flex items-center gap-2">
        <div className="w-5 h-5 bg-accent rounded-[2px] grid place-items-center text-[10px] font-bold text-white">C+</div>
        <span className="font-semibold tracking-tight text-[13px]">HFT Engine <span className="text-mute font-normal">/ AML Monitor</span></span>
      </div>
      <div className="h-full"><Tabs<TabId> tabs={[{ id: 'market', label: 'Market' }, { id: 'crime', label: 'Financial crime' }]} value={tab} onChange={setTab} /></div>
      <div className="hidden lg:flex items-baseline gap-4 num text-[12px]">
        <span><span className="lbl mr-1.5">Last</span><b className="text-[15px]">{last ? px(last) : '–'}</b></span>
        <span><span className="lbl mr-1.5">Fair</span>{fair ? px(fair) : '–'}</span>
        <span><span className="lbl mr-1.5">Msgs/s</span><b>{tick ? compact(tick.ops_per_sec) : '–'}</b></span>
        <span><span className="lbl mr-1.5">Per msg</span>{tick ? ns(tick.avg_ns_per_op) : '–'}</span>
        {bench && <span className="text-up"><span className="lbl mr-1.5">Stress</span>{compact(bench.ops_per_sec)}/s</span>}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className={`chip ${running ? 'text-up border-up/50' : 'text-warn border-warn/50'}`}>{running ? 'MARKET OPEN' : 'MARKET PAUSED'}</span>
        <span className={`chip ${online ? 'text-up border-up/50' : 'text-down border-down/50'}`}><span className="w-1.5 h-1.5 rounded-full" style={{ background: online ? 'var(--up)' : 'var(--down)' }} />{online ? 'Connected' : 'Offline: start the backend'}</span>
      </div>
    </header>
  );
}
