import { Panel } from './ui';
import { Legend, Spark, StackedArea } from './mini';
import { compact, ns } from './agents';
import type { Stats } from './types';
import type { store as Store } from '../lib/store';

const last = (a: number[]) => (a.length ? a[a.length - 1] : 0);

export default function HftPanel({ s, stats }: { s: typeof Store; stats?: Stats }) {
  const q = s.series;
  return (
    <Panel title="HFT footprint" right={<span className="chip">orders per second by participant</span>}>
      <StackedArea layers={[
        { data: q.mm, color: '#3b82f6', label: 'Market makers' }, { data: q.hft, color: '#8f7bf0', label: 'HFT bots' },
        { data: q.retail, color: '#5b6478', label: 'Retail' }, { data: q.crim, color: '#e5484d', label: 'Suspects' }]} />
      <div className="mt-2 grid grid-cols-2 gap-x-3">
        <Legend items={[{ c: '#3b82f6', label: 'Market makers', v: compact(last(q.mm)) + '/s' }, { c: '#8f7bf0', label: 'HFT bots', v: compact(last(q.hft)) + '/s' }]} />
        <Legend items={[{ c: '#5b6478', label: 'Retail', v: compact(last(q.retail)) + '/s' }, { c: '#e5484d', label: 'Suspects', v: compact(last(q.crim)) + '/s' }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3 pt-2 border-t border-line">
        <div><div className="lbl">Messages / s</div><Spark data={q.ops} color="#26a17b" h={34} /><div className="num text-[15px]">{compact(last(q.ops))}</div></div>
        <div><div className="lbl">Cancels per trade</div><Spark data={q.cancelRatio} color="#8f7bf0" h={34} min={0} /><div className="num text-[15px]">{last(q.cancelRatio).toFixed(2)}</div></div>
      </div>
      {stats && (
        <div className="mt-3 pt-2 border-t border-line grid grid-cols-3 gap-2 text-[11px]">
          {([['Match p50', stats.match.p50_ns], ['Match p99', stats.match.p99_ns], ['Avg / msg', stats.sim.avg_ns_per_op]] as [string, number][]).map(([k, v]) => (
            <div key={k}><div className="lbl">{k}</div><div className="num text-[14px]">{ns(v)}</div></div>
          ))}
        </div>
      )}
    </Panel>
  );
}
