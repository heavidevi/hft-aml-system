export type Level = { price: number; qty: number; orders: number };
export type Hist = { count: number; min_ns: number; avg_ns: number; p50_ns: number; p99_ns: number; max_ns: number };
export type Alert = {
  seq: number; kind: 'cycle' | 'structuring' | 'sanction_hit'; score: number;
  amount: number; tick: number; accounts: number[]; frozen: number[]; detector: string; reason: string;
};
export type GNode = { account: number; state: 'ok' | 'sanctioned' | 'frozen'; score: number };
export type GEdge = { from: number; to: number; amount: number };
export type TradeRec = { price: number; qty: number; buyer: number; seller: number };
export type WireRec = { from: number; to: number; amount: number; status: 'ok' | 'blocked'; note: string };
export type Vote = { name: string; vote: number; weight: number; value: number };
export type Signal =
  | { ready: false; bars: number; warmup: number }
  | {
      ready: true; bars: number; direction: 'UP' | 'DOWN' | 'FLAT'; score: number; price: number;
      indicators: { ema_fast: number; ema_slow: number; macd: number; macd_signal: number; rsi: number; boll_upper: number; boll_lower: number; boll_pct_b: number };
      votes: Vote[]; accuracy: { hits: number; total: number; horizon_bars: number };
    };
export type SimTick = {
  steps: number; ops: number; ops_per_sec: number; avg_ns_per_op: number; fair: number; last_price: number;
  scenario: string; stage: number;
  batch: { orders: number; cancels: number; trades: number; volume: number; wires: number; blocked: number };
  agent_orders: { mm: number; hft: number; retail: number; criminal: number };
  recent_trades: TradeRec[]; recent_wires: WireRec[];
  flow: number[][];
  signal: Signal;
};
export type Bench = { steps: number; ops: number; ops_per_sec: number; avg_ns_per_op: number; batch_ns: number; trades: number; cancels: number; orders: number };
export type Stats = {
  match: Hist; aml: Hist; orders: number; rejected: number; trades: number; resting: number;
  bid_levels: number; ask_levels: number;
  bloom: { slots: number; non_zero: number; checks: number; false_positives: number };
  graph: { nodes: number; edges: number; pending: number };
  algo: { cancels: number; purged: number; stale_pops: number; events: number; wires: number; dfs_searches: number; dfs_visits: number; csr_rebuilds: number; alerts: number };
  blocked: { account: number; state: string }[];
  sim: {
    steps: number; orders: number; cancels: number; trades: number; volume: number; wires: number; blocked: number;
    last_ops_per_sec: number; avg_ns_per_op: number; fair: number; last_price: number;
    agent_orders: { mm: number; hft: number; retail: number; criminal: number };
  };
};
export type Snapshot = {
  type: 'snapshot';
  book: { bids: Level[]; asks: Level[]; resting: number };
  stats: Stats;
  alerts: Alert[];
  graph: { nodes: GNode[]; edges: GEdge[] };
};
export type Toast = { id: number; alert: Alert };
export type Raw = { t: number; o: number; h: number; l: number; c: number; v: number };
