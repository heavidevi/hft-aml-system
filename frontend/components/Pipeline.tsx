import { Donut, HBar, Legend, Spark, Columns } from './mini';
import { Panel, Stat } from './ui';
import { compact } from './agents';
import type { Snapshot } from './types';
import type { store as Store } from '../lib/store';

type S = typeof Store;
const last = (a: number[]) => (a.length ? a[a.length - 1] : 0);

function Layer({ n, title, sub, children }: { n: number; title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="border border-line rounded-[3px] bg-panel2/60">
      <div className="flex items-center gap-2 px-2 h-7 border-b border-line">
        <span className="w-4 h-4 rounded-[2px] bg-accent/20 text-[#9cc2ff] text-[10px] font-bold grid place-items-center">{n}</span>
        <span className="text-[11.5px] font-semibold">{title}</span><span className="text-[10px] text-dim ml-auto truncate">{sub}</span>
      </div>
      <div className="p-2 space-y-2">{children}</div>
    </div>
  );
}
const Arrow = () => <div className="flex justify-center -my-1 text-dim" aria-hidden><svg width="10" height="12" viewBox="0 0 10 12"><path d="M5 0v9M1 6l4 5 4-5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></div>;

export default function Pipeline({ snap, s }: { snap: Snapshot | null; s: S }) {
  const st = snap?.stats;
  if (!st) return <Panel title="Engine pipeline"><p className="text-mute">Waiting for engine…</p></Panel>;
  const frozen = st.blocked.filter((b) => b.state === 'frozen').length;
  const sanc = st.blocked.length - frozen;
  const passed = Math.max(0, st.bloom.checks - st.rejected);
  const cr = last(s.series.cancelRatio);
  return (
    <Panel title="Engine pipeline" right={<span className="chip">live rates</span>} bodyClass="space-y-1.5 overflow-auto">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 pb-2 border-b border-line">
        <Stat label="Orders / s" value={compact(last(s.series.orders))} />
        <Stat label="Trades / s" value={compact(last(s.series.trades))} />
        <Stat label="Cancels / trade" value={cr.toFixed(2)} color="var(--violet)" />
        <Stat label="Frozen accts" value={frozen} color={frozen ? 'var(--ice)' : undefined} />
      </div>
      <Layer n={1} title="Gatekeeper" sub="Counting Bloom filter">
        <div className="flex items-center gap-3">
          <Donut parts={[{ v: passed, c: '#26a17b', label: 'Passed' }, { v: st.rejected, c: '#e5484d', label: 'Rejected' }, { v: st.bloom.false_positives, c: '#e0a526', label: 'False pos.' }]}
            center={<span className="text-[10px] text-mute">{st.bloom.checks ? ((st.rejected / st.bloom.checks) * 100).toFixed(2) : 0}%<br />blocked</span>} />
          <Legend items={[{ c: '#26a17b', label: 'Passed', v: compact(passed) }, { c: '#e5484d', label: 'Rejected', v: compact(st.rejected) }, { c: '#e0a526', label: 'False pos.', v: st.bloom.false_positives }]} />
        </div>
        <div><div className="lbl">Checks / s</div><Spark data={s.series.checks} color="#26a17b" /></div>
        <HBar label={`Bloom counters in use (${st.bloom.non_zero} of ${st.bloom.slots.toLocaleString()})`} value={st.bloom.non_zero} max={st.bloom.slots} color="#e0a526" right={`${((st.bloom.non_zero / st.bloom.slots) * 100).toFixed(2)}%`} />
      </Layer>
      <Arrow />
      <Layer n={2} title="Matching" sub="ring · DList · heaps · hash">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Resting" value={compact(st.resting)} />
          <Stat label="Bid lvls" value={st.bid_levels} color="var(--up)" />
          <Stat label="Ask lvls" value={st.ask_levels} color="var(--down)" />
        </div>
        <div><div className="lbl">Orders / s</div><Spark data={s.series.orders} color="#3b82f6" /></div>
        <div><div className="lbl">Cancels / s</div><Spark data={s.series.cancels} color="#8f7bf0" /></div>
        <HBar label="Cancelled vs filled" value={st.algo.cancels} max={st.algo.cancels + st.trades} color="#8f7bf0" right={`${compact(st.algo.cancels)} / ${compact(st.trades)}`} />
      </Layer>
      <Arrow />
      <Layer n={3} title="Event queues" sub="4 partitioned deques">
        <div><div className="lbl">Events / s</div><Spark data={s.series.events} color="#2bb0c9" /></div>
        <HBar label="Stale heap pops (lazy delete)" value={st.algo.stale_pops} max={st.algo.events || 1} color="#2bb0c9" right={compact(st.algo.stale_pops)} />
      </Layer>
      <Arrow />
      <Layer n={4} title="Graph analytics" sub="CSR · DFS ≤ 6 hops">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Nodes" value={st.graph.nodes} /><Stat label="Edges" value={st.graph.edges} /><Stat label="Rebuilds" value={st.algo.csr_rebuilds} />
        </div>
        <HBar label="DFS visits per search" value={st.algo.dfs_searches ? st.algo.dfs_visits / st.algo.dfs_searches : 0} max={20} color="#e5484d" right={st.algo.dfs_searches ? (st.algo.dfs_visits / st.algo.dfs_searches).toFixed(1) : '0'} />
        <div><div className="lbl">Bank wires / s</div><Spark data={s.series.wires} color="#e0a526" /></div>
      </Layer>
      <Arrow />
      <Layer n={5} title="Risk scoring" sub="priority queue → freeze">
        <div className="flex items-center gap-3">
          <Donut parts={[{ v: frozen, c: '#6cb4ee', label: 'Frozen' }, { v: sanc, c: '#f08c3a', label: 'Sanctioned' }]} center={<span><b className="text-[14px]">{st.blocked.length}</b><br /><span className="text-[10px] text-mute">blocked</span></span>} />
          <Legend items={[{ c: '#6cb4ee', label: 'Frozen', v: frozen }, { c: '#f08c3a', label: 'Sanctioned', v: sanc }, { c: '#e5484d', label: 'Alerts raised', v: st.algo.alerts }]} />
        </div>
        <div><div className="lbl">Frozen accounts over time</div><Columns data={s.series.frozen} color="#6cb4ee" h={34} /></div>
      </Layer>
    </Panel>
  );
}
