import type { Toast } from './types';
import { usd } from './agents';

export default function Toasts({ toasts, onClose, onShow }: { toasts: Toast[]; onClose: (id: number) => void; onShow: (a: number[]) => void }) {
  return (
    <div className="fixed top-14 right-4 z-50 w-[360px] max-w-[92vw] space-y-2" aria-live="polite">
      {toasts.map(({ id, alert: a }) => {
        const crime = a.kind !== 'sanction_hit';
        const col = crime ? 'var(--down)' : 'var(--warn)';
        const title = a.kind === 'cycle' ? 'Money laundering: layering loop' : a.kind === 'structuring' ? 'Money laundering: structuring' : 'Sanctioned account blocked';
        return (
          <div key={id} className="toast bg-panel border border-line rounded-[3px] shadow-xl overflow-hidden" style={{ borderLeft: `4px solid ${col}` }} role="alert">
            <div className="p-2.5">
              <div className="flex justify-between gap-2"><b className="text-[12.5px]" style={{ color: col }}>{title}</b><button onClick={() => onClose(id)} className="text-dim hover:text-ink" aria-label="Dismiss">✕</button></div>
              <div className="num text-[11.5px] mt-1">{a.kind === 'cycle' ? a.accounts.join(' → ') + ' → ' + a.accounts[0] : 'Account ' + a.accounts.join(', ')}{a.amount > 0 && <span className="text-mute"> · {usd(a.amount)}</span>}</div>
              <p className="text-[11.5px] text-mute mt-1">{a.reason}</p>
              <div className="flex items-center gap-2 mt-2">
                {a.frozen.length > 0 && <span className="chip text-ice border-ice/50">Frozen: {a.frozen.length}</span>}
                <span className="text-[10.5px] text-dim truncate">{a.detector}</span>
                <button className="btn ml-auto !h-6" onClick={() => onShow(a.accounts)}>Show on graph</button>
              </div>
            </div>
            <div className="h-[2px] bg-line"><div className="h-full" style={{ background: col, animation: 'shrink 10s linear forwards' }} /></div>
          </div>
        );
      })}
    </div>
  );
}
