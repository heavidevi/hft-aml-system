'use client';
// Main chart: candles + volume + EMA/Bollinger overlays, RSI and MACD panes, prediction markers.
// Uses TradingView's open-source lightweight-charts. Candles are aggregated from the engine's price ticks.
import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, AreaSeries, createChart, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts';
import { store } from '../lib/store';
import type { Raw, SimTick } from './types';
import { px } from './agents';

const RES = [{ s: 1, l: '1s' }, { s: 5, l: '5s' }, { s: 15, l: '15s' }, { s: 60, l: '1m' }];
const C = { up: '#26a17b', down: '#e5484d', grid: '#1b2130', text: '#8892a6', accent: '#3b82f6', amber: '#e0a526', violet: '#8f7bf0' };

export default function PriceChart({ height = 470 }: { height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [res, setRes] = useState(5);
  const [style, setStyle] = useState<'candles' | 'area'>('candles');
  const [ind, setInd] = useState({ ema: true, boll: true, rsi: true, macd: true, pred: true });
  const [legend, setLegend] = useState<{ o: number; h: number; l: number; c: number; v: number; ema5?: number; ema13?: number; rsi?: number; chg: number } | null>(null);
  const live = useRef(legend);

  useEffect(() => {
    const el = box.current!;
    const chart: IChartApi = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#141922' }, textColor: C.text, fontSize: 11, panes: { separatorColor: '#262d3b', separatorHoverColor: '#35405a' } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#262d3b' },
      timeScale: { borderColor: '#262d3b', timeVisible: true, secondsVisible: true, rightOffset: 6 },
    });
    const candle = chart.addSeries(CandlestickSeries, { upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down, visible: style === 'candles', priceFormat: { type: 'custom', formatter: (p: number) => px(p) } }, 0);
    const area = chart.addSeries(AreaSeries, { lineColor: C.accent, topColor: 'rgba(59,130,246,.25)', bottomColor: 'rgba(59,130,246,0)', lineWidth: 2, visible: style === 'area', priceFormat: { type: 'custom', formatter: (p: number) => px(p) } }, 0);
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false, priceLineVisible: false }, 0);
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const o = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
    const ema5 = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 1, visible: ind.ema, ...o }, 0);
    const ema13 = chart.addSeries(LineSeries, { color: C.violet, lineWidth: 1, visible: ind.ema, ...o }, 0);
    const bbU = chart.addSeries(LineSeries, { color: '#3b6fb8', lineWidth: 1, lineStyle: 2, visible: ind.boll, ...o }, 0);
    const bbL = chart.addSeries(LineSeries, { color: '#3b6fb8', lineWidth: 1, lineStyle: 2, visible: ind.boll, ...o }, 0);
    const rsi = chart.addSeries(LineSeries, { color: C.violet, lineWidth: 1, visible: ind.rsi, priceFormat: { type: 'custom', formatter: (v: number) => v.toFixed(0) }, ...o }, 1);
    rsi.createPriceLine({ price: 70, color: '#5b6478', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    rsi.createPriceLine({ price: 30, color: '#5b6478', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' });
    const macdH = chart.addSeries(HistogramSeries, { visible: ind.macd, priceLineVisible: false, lastValueVisible: false }, 2);
    const macdL = chart.addSeries(LineSeries, { color: C.accent, lineWidth: 1, visible: ind.macd, ...o }, 2);
    const macdS = chart.addSeries(LineSeries, { color: C.amber, lineWidth: 1, visible: ind.macd, ...o }, 2);
    const panes = chart.panes();
    if (panes[1]) panes[1].setHeight(Math.round(height * 0.17));
    if (panes[2]) panes[2].setHeight(Math.round(height * 0.17));
    const markers = createSeriesMarkers(candle, []);
    const markerList: SeriesMarker<Time>[] = [];

    let cur: { t: number; o: number; h: number; l: number; c: number; v: number } | null = null;
    let lastDir = '';
    const bucket = (t: number) => (Math.floor(t / res) * res) as UTCTimestamp;
    const draw = (b: typeof cur) => {
      if (!b) return;
      const t = b.t as UTCTimestamp;
      candle.update({ time: t, open: b.o, high: b.h, low: b.l, close: b.c });
      area.update({ time: t, value: b.c });
      vol.update({ time: t, value: b.v, color: b.c >= b.o ? 'rgba(38,161,123,.35)' : 'rgba(229,72,77,.35)' });
    };
    const ingest = (r: Raw) => {
      const t = bucket(r.t);
      if (!cur || cur.t !== t) { cur = { t, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v }; }
      else { cur.h = Math.max(cur.h, r.h); cur.l = Math.min(cur.l, r.l); cur.c = r.c; cur.v += r.v; }
      draw(cur);
    };
    const signalPoint = (t: SimTick, time: UTCTimestamp) => {
      if (!t.signal.ready) return;
      const i = t.signal.indicators;
      ema5.update({ time, value: i.ema_fast }); ema13.update({ time, value: i.ema_slow });
      bbU.update({ time, value: i.boll_upper }); bbL.update({ time, value: i.boll_lower });
      rsi.update({ time, value: i.rsi });
      const h = i.macd - i.macd_signal;
      macdH.update({ time, value: h, color: h >= 0 ? 'rgba(38,161,123,.7)' : 'rgba(229,72,77,.7)' });
      macdL.update({ time, value: i.macd }); macdS.update({ time, value: i.macd_signal });
      if (t.signal.direction !== lastDir) {
        lastDir = t.signal.direction;
        if (lastDir !== 'FLAT') {
          markerList.push({ time, position: lastDir === 'UP' ? 'belowBar' : 'aboveBar', shape: lastDir === 'UP' ? 'arrowUp' : 'arrowDown', color: lastDir === 'UP' ? C.up : C.down, text: lastDir === 'UP' ? 'BUY' : 'SELL' });
          if (markerList.length > 40) markerList.shift();
          markers.setMarkers(ind.pred ? [...markerList] : []);
        }
      }
    };

    // history from the raw tick buffer (so switching resolution keeps the past)
    store.raw.forEach(ingest);
    // backfill indicator lines and prediction markers for the chosen resolution (last value per bucket)
    const lastBy = new Map<number, (typeof store.sigHist)[number]>();
    store.sigHist.forEach((p) => lastBy.set(bucket(p.t), p));
    const times = [...lastBy.keys()].sort((a, b) => a - b);
    const line = (f: (p: (typeof store.sigHist)[number]) => number) => times.map((t) => ({ time: t as UTCTimestamp, value: f(lastBy.get(t)!) }));
    ema5.setData(line((p) => p.e5)); ema13.setData(line((p) => p.e13)); bbU.setData(line((p) => p.bu)); bbL.setData(line((p) => p.bl));
    rsi.setData(line((p) => p.rsi)); macdL.setData(line((p) => p.macd)); macdS.setData(line((p) => p.ms));
    macdH.setData(times.map((t) => { const p = lastBy.get(t)!, h = p.macd - p.ms; return { time: t as UTCTimestamp, value: h, color: h >= 0 ? 'rgba(38,161,123,.7)' : 'rgba(229,72,77,.7)' }; }));
    store.marks.forEach((m) => markerList.push({ time: bucket(m.t), position: m.dir === 'UP' ? 'belowBar' : 'aboveBar', shape: m.dir === 'UP' ? 'arrowUp' : 'arrowDown', color: m.dir === 'UP' ? C.up : C.down, text: m.dir === 'UP' ? 'BUY' : 'SELL' }));
    markers.setMarkers(ind.pred ? [...markerList] : []);
    lastDir = store.marks.length ? store.marks[store.marks.length - 1].dir : '';
    chart.timeScale().scrollToRealTime();

    const off = store.onTick((t, r) => {
      ingest(r);
      signalPoint(t, bucket(r.t));
      const l = {
        o: cur!.o, h: cur!.h, l: cur!.l, c: cur!.c, v: cur!.v,
        ema5: t.signal.ready ? t.signal.indicators.ema_fast : undefined, ema13: t.signal.ready ? t.signal.indicators.ema_slow : undefined,
        rsi: t.signal.ready ? t.signal.indicators.rsi : undefined, chg: cur!.o ? ((cur!.c - cur!.o) / cur!.o) * 100 : 0,
      };
      live.current = l;
    });
    const timer = setInterval(() => live.current && setLegend(live.current), 300);
    return () => { clearInterval(timer); off(); chart.remove(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res, style, ind.ema, ind.boll, ind.rsi, ind.macd, ind.pred]);

  const Tog = ({ k, label }: { k: keyof typeof ind; label: string }) => (
    <button className={`btn ${ind[k] ? 'btn-on' : ''}`} onClick={() => setInd((s) => ({ ...s, [k]: !s[k] }))} aria-pressed={ind[k]}>{label}</button>
  );
  const up = (legend?.c ?? 0) >= (legend?.o ?? 0);
  return (
    <section className="panel">
      <header className="flex items-center gap-2 px-2 h-9 border-b border-line flex-wrap">
        <span className="font-semibold text-[13px] pl-1">SIM / USD</span>
        <span className="chip">C++ matching engine</span>
        <div className="w-px h-4 bg-line mx-1" />
        {RES.map((r) => <button key={r.s} className={`btn ${res === r.s ? 'btn-on' : ''}`} onClick={() => setRes(r.s)}>{r.l}</button>)}
        <div className="w-px h-4 bg-line mx-1" />
        <button className={`btn ${style === 'candles' ? 'btn-on' : ''}`} onClick={() => setStyle('candles')}>Candles</button>
        <button className={`btn ${style === 'area' ? 'btn-on' : ''}`} onClick={() => setStyle('area')}>Area</button>
        <div className="w-px h-4 bg-line mx-1" />
        <span className="lbl hidden md:inline">Indicators</span>
        <Tog k="ema" label="EMA 5/13" /><Tog k="boll" label="Bollinger" /><Tog k="rsi" label="RSI" /><Tog k="macd" label="MACD" /><Tog k="pred" label="Signals" />
      </header>
      <div className="relative" style={{ height }}>
        {legend && (
          <div className="absolute z-10 left-2 top-1.5 num text-[11px] pointer-events-none flex flex-wrap gap-x-3 gap-y-0.5 bg-panel/80 px-1 rounded">
            <span className="text-mute">O <b className="text-ink">{px(legend.o)}</b></span>
            <span className="text-mute">H <b className="text-ink">{px(legend.h)}</b></span>
            <span className="text-mute">L <b className="text-ink">{px(legend.l)}</b></span>
            <span className="text-mute">C <b style={{ color: up ? C.up : C.down }}>{px(legend.c)}</b></span>
            <span style={{ color: up ? C.up : C.down }}>{legend.chg >= 0 ? '+' : ''}{legend.chg.toFixed(2)}%</span>
            <span className="text-mute">Vol <b className="text-ink">{legend.v.toLocaleString()}</b></span>
            {ind.ema && legend.ema5 !== undefined && <span style={{ color: C.amber }}>EMA5 {px(legend.ema5)}</span>}
            {ind.ema && legend.ema13 !== undefined && <span style={{ color: C.violet }}>EMA13 {px(legend.ema13!)}</span>}
            {ind.rsi && legend.rsi !== undefined && <span className="text-mute">RSI <b className="text-ink">{legend.rsi.toFixed(1)}</b></span>}
          </div>
        )}
        <div ref={box} className="absolute inset-0" />
      </div>
    </section>
  );
}
