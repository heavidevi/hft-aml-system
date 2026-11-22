import { Panel } from './ui';
import { SemiGauge, Spark } from './mini';
import type { Signal } from './types';

export default function SignalPanel({ s, rsi, hist }: { s?: Signal; rsi: number[]; hist: number[] }) {
  if (!s || !s.ready) return <Panel title="Price signal"><p className="text-mute">Warming up indicators: {s?.bars ?? 0}/{s && !s.ready ? s.warmup : 30} bars</p></Panel>;
  const up = s.direction === 'UP', down = s.direction === 'DOWN';
  const color = up ? 'var(--up)' : down ? 'var(--down)' : 'var(--mute)';
  const pct = s.accuracy.total ? (s.accuracy.hits / s.accuracy.total) * 100 : 0;
  const chip = (v: number) => (v > 0 ? <span className="text-up">▲ Buy</span> : v < 0 ? <span className="text-down">▼ Sell</span> : <span className="text-dim">– Neutral</span>);
  return (
    <Panel title="Price signal" right={<span className="chip">7 indicators · C++</span>}>
      <div className="flex items-center gap-3">
        <div className="w-[46%]"><SemiGauge value={s.score} /><div className="text-center num -mt-1 text-[11px] text-mute">score <b className="text-ink">{s.score > 0 ? '+' : ''}{s.score}</b></div></div>
        <div className="flex-1">
          <div className="lbl">Call</div>
          <div className="text-[22px] font-semibold leading-none" style={{ color }}>{up ? 'BUY' : down ? 'SELL' : 'NEUTRAL'}</div>
          <div className="lbl mt-2">RSI (14)</div><Spark data={rsi} color="#8f7bf0" h={22} min={0} />
          <div className="lbl mt-1">MACD histogram</div><Spark data={hist} color="#3b82f6" h={22} />
        </div>
      </div>
      <table className="w-full text-[11.5px] mt-2">
        <tbody>{s.votes.map((v) => (
          <tr key={v.name} className="border-t border-line">
            <td className="py-[3px] text-mute">{v.name}</td>
            <td className="num text-right">{v.value.toFixed(Math.abs(v.value) < 10 ? 2 : 1)}</td>
            <td className="text-right w-[64px]">{chip(v.vote)}</td>
            <td className="num text-right text-dim w-7">{v.weight}</td>
          </tr>))}
        </tbody>
      </table>
      <div className="mt-2 text-[11px]">
        <div className="flex justify-between"><span className="text-mute">Measured hit rate ({s.accuracy.horizon_bars} bars ahead)</span><span className="num">{pct.toFixed(1)}% of {s.accuracy.total.toLocaleString()}</span></div>
        <div className="relative h-1.5 bg-[#222a38] mt-1"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /><div className="absolute inset-y-[-2px] w-px bg-ink/70" style={{ left: '50%' }} /></div>
        <p className="text-dim mt-1">Synthetic prices: about 50% is expected. Not investment advice.</p>
      </div>
    </Panel>
  );
}
