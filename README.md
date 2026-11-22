# High-Frequency Execution & Real-Time AML Streaming Engine

FAST-NUCES · CS-2001 Data Structures Lab · Fall 2026 · local demo (no Docker)

A stock exchange that lives inside a C++17 program: market makers, HFT bots and retail traders send orders, a matching engine
fills them, and a five-layer AML pipeline catches criminals laundering money with bank wires. A thin Node server relays the engine's
output over REST/WebSocket and a Next.js dashboard shows it live, with a popup whenever laundering is detected.
The dashboard can be uploaded to Vercel (see `DEPLOYMENT.md`).

**Read `HOW_IT_WORKS.md`** for what every panel means, worked examples of each detector, the APIs and viva questions.
`PROMPT.md` has a master prompt to rebuild or extend the project with Claude. `CLAUDE.md` holds the working rules for Claude.

```
C++ engine (Sim + 5 layers) ──stdin/stdout JSON lines──▶ Node bridge ──WebSocket/REST──▶ Next.js dashboard
```

## Run locally
Requirements: g++ (C++17), make, Node 18+ (20 recommended). On Windows use WSL2 or MSYS2.

```bash
npm install
npm run run:all             # setup + concurrently run backend, frontend, backend tests
# or, after setup:
npm run dev:all             # http://localhost:4000 + http://localhost:3000 + backend REST tests
```
Open `localhost:3000`: prices, the book and the trade tape move immediately and a laundering popup appears within a few seconds.
Click **C++ stress test** to make the engine run 1,000,000 simulation steps back-to-back and report the real throughput.

## The 5 layers (`engine/`)
| Layer | Structure (`include/ds.h`) |
|---|---|
| L1 sanctions / freeze gate | Counting Bloom filter + exact HashMap |
| L2 ingress + order book | SPSC ring; per-price DList; price/id HashMaps; bid max-heap, ask min-heap |
| L3 events | 4 partitioned Deques |
| L4 analytics | Dynamic CSR graph + bounded DFS (cycles ≤ 6); sliding window + monotonic Deque (smurfing) |
| L5 risk | Priority-queue Heap; score 100 freezes the account and feeds back into L1 |

No `std::vector/map/unordered_map/queue/priority_queue/list` in the core; `std::string` only builds JSON.
`src/sim.cpp` is the in-engine market simulator; `src/main.cpp` is the line protocol (documented at the top of the file).

## Demo script
1. Watch the pipeline counters, book and tape move (HFT bots flicker quotes: cancels outnumber trades).
2. Within ~5 s a red popup appears: layering loop, smurfing fan-in, or a sanctioned account. The graph shows the ring, accounts turn red and pulse.
3. In the wire feed the frozen criminal's next order shows `✗ frozen`: the L5 to L1 freeze loop working.
4. Press the stress-test button and read messages/second.

## Limits (be upfront)
- Prices, traders and criminals are synthetic; thresholds are demo constants at the top of `engine/include/engine.h`.
- The engine core is single-threaded; `SpscRing` is lock-free but not used across threads.
- Latency percentiles come from a log2 histogram and Windows timers are coarse: trust the batch average (ns per message).
- Exchange trades deliberately do not feed the AML graph (only bank wires do) so honest HFT firms are never flagged.
- The GitHub Actions file (`.github/workflows/ci.yml`) only builds and tests and was not run on GitHub.
