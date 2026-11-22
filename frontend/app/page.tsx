'use client';
import { useCallback, useEffect, useState } from 'react';
import { store, useLive } from '../lib/store';
import { useGraph } from '../lib/useGraph';
import TopBar, { TabId } from '../components/TopBar';
import Pipeline from '../components/Pipeline';
import PriceChart from '../components/PriceChart';
import OrderBook from '../components/OrderBook';
import SignalPanel from '../components/SignalPanel';
import FlowMap from '../components/FlowMap';
import HftPanel from '../components/HftPanel';
import Imbalance from '../components/Imbalance';
import MoneyGraph from '../components/MoneyGraph';
import { Layering, Sanctions, Smurfing } from '../components/CrimeExplainers';
import CrimeAnalytics from '../components/CrimeAnalytics';
import BottomPanel from '../components/BottomPanel';
import Controls from '../components/Controls';
import Toasts from '../components/Toasts';

const ZERO = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];

export default function Dashboard() {
  const s = useLive();
  const [tab, setTab] = useState<TabId>('market');
  const [running, setRunning] = useState(true);
  const [focus, setFocus] = useState<{ accounts: number[]; n: number } | null>(null);
  const [flow, setFlow] = useState<number[][]>(ZERO);
  const g = useGraph(400, 2000);

  useEffect(() => { store.connect(); return () => store.disconnect(); }, []);
  // decaying window of traded lots between participant groups
  useEffect(() => store.onTick((t) => setFlow((f) => f.map((r, b) => r.map((v, k) => v * 0.97 + (t.flow?.[b]?.[k] ?? 0))))), []);
  const showOnGraph = useCallback((accounts: number[]) => { setTab('crime'); setFocus({ accounts, n: Date.now() }); }, []);

  const snap = s.snap, tick = s.tick, alerts = snap?.alerts ?? [];
  return (
    <div className="flex flex-col min-h-screen lg:h-screen">
      <Toasts toasts={s.toasts} onClose={store.dismissToast} onShow={showOnGraph} />
      <TopBar tab={tab} setTab={setTab} online={s.online} tick={tick} running={running} bench={s.bench} />
      <main className="flex-1 min-h-0 grid gap-2 p-2 lg:grid-cols-[292px_minmax(0,1fr)_320px]">
        <div className="lg:overflow-auto lg:min-h-0 order-3 lg:order-1"><Pipeline snap={snap} s={s} /></div>

        <div className="flex flex-col gap-2 min-h-0 min-w-0 order-1 lg:order-2">
          <div className="lg:flex-1 lg:overflow-auto min-h-0 space-y-2">
            {tab === 'market' ? (
              <>
                <PriceChart />
                <div className="grid gap-2 xl:grid-cols-3 md:grid-cols-2">
                  <OrderBook bids={snap?.book.bids ?? []} asks={snap?.book.asks ?? []} />
                  <SignalPanel s={tick?.signal} rsi={s.series.rsi} hist={s.series.hist} />
                  <div className="space-y-2 md:col-span-2 xl:col-span-1">
                    <FlowMap flow={flow} orders={snap?.stats.sim.agent_orders} />
                  </div>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <HftPanel s={s} stats={snap?.stats} />
                  <Imbalance flow={s.series.flowImb} book={s.series.bookImb} />
                </div>
              </>
            ) : (
              <>
                <MoneyGraph alerts={alerts} focus={focus} />
                <div className="grid gap-2 xl:grid-cols-3 md:grid-cols-2">
                  <Layering alerts={alerts} edges={g.edges} />
                  <Smurfing alerts={alerts} edges={g.edges} />
                  <Sanctions alerts={alerts} stats={snap?.stats} />
                </div>
                <CrimeAnalytics alerts={alerts} nodes={g.nodes} frozenSeries={s.series.frozen} />
              </>
            )}
          </div>
          <BottomPanel alerts={alerts} wires={s.wires} trades={s.trades} stats={snap?.stats} onShow={showOnGraph} />
        </div>

        <div className="lg:overflow-auto lg:min-h-0 order-2 lg:order-3"><Controls running={running} onRunning={setRunning} bench={s.bench} onBench={(b) => { store.bench = b; }} /></div>
      </main>
    </div>
  );
}
