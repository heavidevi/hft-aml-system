# Master prompt (paste into Claude / Claude Code to rebuild or extend this project)

Put `CLAUDE.md` in the repo root first so the assistant follows the working rules (ask when unsure, minimal code, surgical edits, verify).

---

Act as a principal systems engineer. Project: **"High-Frequency Execution & Real-Time AML Streaming Engine"**, a university Data Structures lab project (FAST-NUCES, Fall 2026). It is a demo, runs locally, no Docker.

## Architecture (do not change without asking)
Monorepo: `engine/` (C++17) · `backend/` (Node.js, Express + `ws`) · `frontend/` (Next.js 14 App Router + Tailwind).
The Node server spawns `engine/build/hft_engine` and talks to it with a line protocol over stdin/stdout (`RES {json}` per command, `EVT {json}` pushed for alerts). **All market logic, simulation and detection run in C++.** Node and the browser contain no business logic.

## Engine requirements
- Custom data structures only in the core (no `std::vector/map/unordered_map/queue/priority_queue/list`): DynArray, binary Heap (comparator), open-addressing HashMap (uint64 keys, tombstones), DList, lock-free SPSC ring buffer, circular Deque (also used as monotonic deque), Counting Bloom filter (add/remove), Dynamic CSR graph (pending buffer + counting-sort rebuild). `std::string` only to build JSON.
- Five layers: **L1** counting-Bloom gatekeeper + exact map; **L2** SPSC ring → order book (per-price DList FIFO, price→level and id→node hash maps, bid max-heap / ask min-heap with lazy deletion, price-time priority, self-trade prevention); **L3** partitioned event queues; **L4** bounded-DFS cycle detection (k ≤ 6, visit budget) on the CSR graph of bank wires, plus sliding-window structuring detection with a monotonic deque; **L5** risk priority queue, score ≥ 100 freezes the account and feeds back into L1.
- Exchange trades must NOT create AML graph edges (they would flag honest HFT firms). Only wires do.
- Alerts carry `kind`, `score`, `accounts`, `frozen`, `detector` (algorithm name) and a plain-English `reason` with the evidence numbers.
- A built-in **simulator in C++** (`SIM steps launder_every pace`): market makers (quote/cancel), HFT bots (momentum + flicker quotes), retail, and criminal rings (smurfing, 4-account layering cycle, sanctioned account), each ring ending with a "probe" order from a frozen account. Output per batch: ops/sec, ns/op, last price, recent trades, recent wires, per-agent counts.
- Counters exposed in `STATS`: cancels, stale heap pops, events, wires, DFS searches/visits, CSR rebuilds, alerts, Bloom checks/false positives, latency histograms.
- Tunables (cents) at the top of `engine/include/engine.h`.

## Backend requirements
REST: book, stats, alerts, graph, status, order, cancel, transfer, sanction, unfreeze, reset, sim control, bench, scenarios. WebSocket `/ws`: `snapshot` every 250 ms, `tick` every 100 ms from `SIM`, `alert` immediately on `EVT`, `bench`. Validate every number (reject anything that is not a non-negative safe integer) so commands cannot be injected.

## Frontend requirements (dark mode)
Live order book with depth bars; trade tape coloured by participant type; last-price chart; engine speed card (messages/s, ns/message); pipeline strip with live per-layer counters; money-flow graph clustered by connected component (red = cycle, amber = smurfing fan-in, pulsing red = frozen); wire feed with blocked attempts; alert queue with click-through evidence; **real-time popup toast** when an alert arrives; explainer panel; controls (pause, speed, criminal frequency, reset, 1M-step C++ stress test, manual order and scenarios).

## Acceptance criteria (loop until all pass, show the output)
1. `make -C engine test` builds with ASan/UBSan and prints `0 failed`. Tests cover each data structure, price-time priority, partial fills, cancel, duplicate/invalid orders, sanctions, a 4-cycle is flagged while a 7-cycle and light edges are not, smurfing positive and negatives, and: after 30,000 simulated steps cycle/structuring/sanction alerts exist and **no market maker, HFT or retail account is frozen**.
2. `npm test -w backend` passes against the real engine binary.
3. `npm run build -w frontend` succeeds.
4. Opening the dashboard shows prices, book and tape moving within a second, and a laundering popup within ~5 seconds, with no manual action.

Before writing code: state assumptions and ask if anything is unclear. Then give a short plan with a verification step per item.

---

## Follow-up prompts you can use later
- *Wash trading:* "Add a criminal scenario where two accounts trade back and forth at prices far from fair value. Detect it in the engine by comparing trade price with the simulator's fair value and add an alert kind `wash_trade`. Add a test and a dashboard colour."
- *Real threads:* "Run the matching engine on one thread and the AML stages on another, connected by the existing SpscRing, keeping the tests green. Show before/after throughput."
- *N-API:* "Replace the stdin/stdout bridge with a node-addon-api wrapper; the engine library must stay unchanged."
- *Explain for viva:* "Walk me through one order and one cycle detection using the real numbers from the STATS output."
