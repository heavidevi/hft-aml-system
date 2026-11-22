# How it works: what is actually happening on screen

This is a small stock exchange that runs entirely inside a C++ program, plus an anti-money-laundering (AML) system watching it.
Nothing on the dashboard is faked in JavaScript: the Node server only relays what the C++ engine computes, and the browser only draws it.

```
 C++ engine process (hft_engine)                          Node bridge                 Browser
 ┌───────────────────────────────────────────┐   stdin/   ┌──────────────┐  WebSocket ┌───────────┐
 │ Sim: market makers, HFT bots, retail,     │   stdout   │ asks for the │ ─────────▶ │ dashboard │
 │      criminal rings                       │ ◀────────▶ │ next 100     │  tick /    │ (Next.js) │
 │  └▶ Engine: L1 gate → L2 book → L3 queues │ JSON lines │ steps every  │  snapshot /│           │
 │            → L4 graph → L5 risk → freeze  │            │ 100 ms       │  alert     │           │
 └───────────────────────────────────────────┘            └──────────────┘            └───────────┘
```

## 1. Who is trading (all generated in C++, `engine/src/sim.cpp`)

One simulation **step** = one randomly chosen participant acts. The sim keeps a hidden "fair value" that does a random walk (dashed line on the price chart).

| Who | Accounts | Behaviour | Why it looks like HFT |
|---|---|---|---|
| Market makers | 1001–1004 | Post a buy and a sell quote around fair value, cancel their oldest quotes when they have 12 live | Constant quote refresh: cancels outnumber trades |
| HFT bots | 2001–2004 | If the last trade price lags fair value they cross the spread immediately (momentum). Otherwise they post a quote and cancel it at once ("flickering") | High message rate, tiny orders, huge order-to-trade ratio |
| Retail | 3001–3060 | Random limit orders around fair value, 1 in 5 marketable | Background noise and liquidity |
| Criminals | ≥ 80000 | Scripted rings (section 3), one every few seconds | The thing AML must catch |

The engine does ~2–7 million messages per second on a laptop (orders + cancels + wires). The browser only sees a slice: ~1,000 steps/s at "Normal" so that you can follow it.
The **C++ stress test** button makes the engine run 1,000,000 steps back-to-back and reports the true throughput.

## 2. Life of one order (layers L1 → L5)

Example: HFT bot 2003 sends `BUY 3 @ 100.02`.

1. **L1 gatekeeper.** `CountingBloom.maybe(2003)`: three counters are checked. Any zero means "definitely not blocked" and the order passes in a few ns. If all are non-zero the exact `HashMap` is consulted so Bloom false positives never block an honest account. Blocked accounts (sanctioned or frozen) are rejected here.
2. **L2 ring + order book.** The order enters the `SpscRing` (lock-free queue), is popped and matched.
   - Each price has a **level**: a `DList` of orders in arrival order (price-time priority).
   - A `HashMap` maps price → level and order-id → list node, so cancel is O(1).
   - Two `Heap`s of prices (max-heap for bids, min-heap for asks) give the best price in O(1).
   - The bot's buy is compared with the best ask. If `ask ≤ 100.02` they trade at the *resting* order's price, quantities are reduced, empty levels are removed. Whatever is left rests in the book.
   - Self-trade prevention: if the resting order belongs to the same account it is cancelled instead of traded.
3. **L3 event queues.** Every trade becomes an event `(buyer, seller, amount)` pushed into one of 4 `Deque` partitions chosen by hashing the sender.
4. **L4 graph analytics.** Events from *exchange trades* only update counters (they are cleared by the exchange and are not money-movement evidence). *Bank wires* (transfers) add edges to the money-flow graph and run the detectors in section 3.
5. **L5 risk scoring.** Detectors push alerts into a priority queue (highest score first). Each alert adds its score to the accounts involved; at **100** the account is frozen. Freezing writes the account into the L1 Bloom filter and exact map, so the next order or wire from it is rejected at step 1. That loop (L5 → L1) is the "freeze signal".

Why trades are not in the graph: market makers and HFT bots trade with each other thousands of times; accumulated flows between a few accounts would form "cycles" and freeze honest firms. Real AML systems work on funds transfers, KYC and trade surveillance separately. The test suite asserts that no market maker, HFT or retail account is ever frozen.

## 3. How money laundering is detected

All amounts are cents internally; below they are in dollars.

### Layering: circular flow (`DynCsr` + bounded DFS)
Ring script: accounts A→B→C→D→A, $60,000 per hop, one wire every ~0.1 s.
- Each wire adds an edge to `DynCsr` (new edges wait in a small buffer; every 32 edges a counting-sort rebuild packs them into compact CSR arrays).
- After each wire `u→v`, if the edge's cumulative weight is ≥ **$50,000**, the engine searches for a path **from v back to u** using DFS limited to **6 accounts**, following only edges ≥ $50,000, with a 20,000-visit budget.
- When the fourth wire D→A closes the loop, the DFS finds `A→B→C→D→A`. Alert: *"Circular flow … money came back to where it started: layering."* Score 100 on every member → all four frozen.
- Loops longer than 6 and loops of light edges are ignored (covered by tests).

### Structuring / smurfing (sliding window + monotonic deque)
Ring script: six "mules" each wire **$9,000** (under the $10,000 reporting limit) into one collector.
- For each receiver the engine keeps the wires of the last **50 wire ticks** in a `Deque` (count and running sum) and a **monotonic deque** that always has the window maximum at its front, all in amortised O(1).
- Alert when: ≥ 5 wires in the window **and** the largest is < $10,000 **and** the sum ≥ $10,000. Here: 5 wires, largest $9,000, total $45,000 → collector frozen.
- One big wire, or a slow drip spread beyond the window, does not trigger it.

### Sanctions (L1)
`SANCTION <acct>` puts the account in the Bloom filter and exact map. Any order or wire from or to it is rejected and an informational alert is raised.

### After the flag
Each ring ends with a **probe**: the criminal tries to place an order. The dashboard's wire feed shows it blocked (`frozen` or `sanctioned`) with a red ✗, which proves the freeze loop works.

## 4. Reading the dashboard

| Area | Meaning |
|---|---|
| Red popup (top right) | Real-time alert from the C++ engine: what was found, which algorithm found it, who was frozen |
| KPI row | Cumulative counters from the engine; "messages / sec" is the latest batch rate |
| Pipeline strip | One card per layer with live counters: Bloom checks, DFS searches/visits, CSR rebuilds, stale heap pops… watch them climb |
| Order book | Top 12 levels per side straight from the heaps, depth bars = quantity, right column = number of orders at that price |
| Trade tape | Last trades coloured by participant type (MM, HFT, Retail, Suspect) |
| Price chart | Last trade price; dashed line = hidden fair value |
| Engine speed | Messages/s and ns per message measured over whole batches |
| Money-flow graph | Bank wires ≥ $1,000 from the last 40 wires, one cluster per connected group. Red edges = layering loop, amber = smurfing fan-in, red pulsing node = frozen, yellow = sanctioned |
| Wire feed | Individual wires and blocked attempts |
| Alert queue + explainer | Click an alert for its evidence text and the rule that fired |

Controls: pause/resume, speed (20 / 100 / 500 steps per tick), how often criminal rings appear, reset, manual orders and scenarios.

## 5. APIs

### Engine line protocol (`engine/build/hft_engine`, one command per line)
```
ORDER <id> <acct> <B|S> <price_cents> <qty>      CANCEL <id>      TRANSFER <from> <to> <cents>
SANCTION <acct>   UNFREEZE <acct>   STATUS <acct>   STATE [depth]   ALERTS   STATS   RESET
GRAPH [min_cents] [window_wires]
SIM [steps=40] [launder_every=0] [pace=25]     run the built-in market; launder_every 0 = no criminals
```
Replies: `RES {json}` per command; alerts are pushed as `EVT {json}` lines first. Try:
`printf 'SIM 4000 300 3\nSTATS\n' | engine/build/hft_engine`

### REST (backend, default `http://localhost:4000`)
| Route | Purpose |
|---|---|
| `GET /api/book` `/api/stats` `/api/alerts` `/api/graph?min=&window=` `/api/status/:account` | read state |
| `POST /api/order {account, side:"B"/"S", price, qty}` `/api/cancel {id}` `/api/transfer {from,to,amount}` | act |
| `POST /api/sanction {account}` `/api/unfreeze {account}` `/api/reset` | admin |
| `GET/POST /api/sim {running, steps, launderEvery, pace}` | control the C++ market |
| `POST /api/bench {n}` | C++ stress test (default 1,000,000 steps) |
| `POST /api/scenario/smurf|cycle|sanction|market` | trigger one scenario now |

### WebSocket `ws://localhost:4000/ws`
`snapshot` (every 250 ms: book, stats, alerts, graph) · `tick` (every 100 ms: batch rate, price, recent trades and wires) · `alert` (immediately when a detector fires) · `bench` (stress-test result) · `trades` (from manual orders).

## 6. Complexity cheat sheet

| Operation | Structure | Cost |
|---|---|---|
| Blocked check | Counting Bloom + HashMap | O(k) ≈ O(1) |
| Insert order at existing level / cancel | DList + HashMap | O(1) |
| Insert at a new price level | Heap push | O(log P) |
| Best price / match one fill | Heap top / DList head | O(1) |
| Add wire edge | DynCsr pending buffer | O(1) amortised, rebuild O(V+E) every 32 edges |
| Cycle search | Bounded DFS | O(b^k) worst case, k ≤ 6, 20k budget |
| Smurfing window update | Deque + monotonic deque | O(1) amortised |
| Alert ordering | Heap | O(log n) |

## 7. What is simulated and what is not (be upfront in the viva)
- Prices, participants and criminals are **synthetic**; thresholds ($10k, $50k, 5 wires, 6 hops, score 100) are demo constants in `engine/include/engine.h`.
- The engine core is **single-threaded**; `SpscRing` is a correct lock-free queue but is not used across two threads here.
- Latency histogram buckets are powers of two and Windows timers are coarse, so the batch average is the reliable speed number.
- Real AML also uses KYC, customer risk and human review; this demo covers transaction-pattern detection only.
- Sanctions list is tiny and entered by hand.

## 8. Likely viva questions
- *Why a Bloom filter in front of a hash map?* Most traffic is clean; the Bloom answers "definitely clean" with k memory reads and no cache-missing hash probe. The map removes false positives.
- *Why a counting Bloom filter?* Frozen accounts can be unfrozen; plain Bloom filters cannot delete.
- *Why CSR?* Contiguous arrays make DFS cache-friendly; the pending buffer avoids rebuilding on every edge.
- *Why bound the DFS?* Cycle search is exponential in general; real laundering loops are short, so k ≤ 6 plus a visit budget gives predictable latency.
- *Why a monotonic deque?* Window max in O(1) amortised instead of rescanning the window.
- *Why lazy deletion in the price heap?* Removing an arbitrary price from a binary heap is O(n); we skip stale prices when they surface (`stale heap pops` counter).
