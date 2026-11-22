// 5-layer pipeline:
//   L1 CountingBloom gatekeeper -> L2 SpscRing + OrderBook (DList + heaps + hash)
//   -> L3 partitioned event queues -> L4 DynCsr graph + bounded DFS / sliding window
//   -> L5 risk priority queue -> freeze signal back into L1.
#pragma once
#include <cstdint>
#include <string>

#include "ds.h"

namespace hft {

// ---- tunables (all money is in cents) ----
constexpr int64_t REPORT_THRESHOLD = 1000000;   // $10,000: structuring limit
constexpr int STRUCT_MIN_COUNT = 5;             // sub-limit transfers in window
constexpr uint64_t STRUCT_WINDOW = 50;          // window length in transfer ticks
constexpr int64_t CYCLE_MIN_EDGE = 5000000;     // $50,000: edge weight that counts for cycles
constexpr int MAX_CYCLE_LEN = 6;                // bounded DFS: k <= 6
constexpr int DFS_BUDGET = 20000;               // hard cap on DFS edge visits per search
constexpr int FREEZE_THRESHOLD = 100;           // account risk score that freezes it
constexpr int SCORE_CYCLE = 100;
constexpr int SCORE_STRUCT = 100;
constexpr int PARTS = 4;                        // L3 partitions
constexpr size_t RING_SIZE = 1024;              // L2 ring capacity (power of two)
constexpr int HISTORY = 64;                     // alerts kept for the dashboard

enum Block : uint8_t { SANCTIONED = 1, FROZEN = 2 };
enum AlertKind : uint8_t { CYCLE = 0, STRUCTURING = 1, SANCTION_HIT = 2 };

struct Order { uint64_t id; uint32_t acct; bool buy; int64_t price, qty; };
struct Trade { uint64_t makerId, takerId; uint32_t buyer, seller; int64_t price, qty; };
struct Event { uint32_t from, to; int64_t amt; bool wire; };  // wire = bank transfer (graph), else exchange trade
struct EdgeInfo { int64_t w; uint64_t tick; };
struct Alert {
  uint64_t seq; AlertKind kind; int score; int64_t amount; uint64_t tick;
  int n; uint32_t accts[MAX_CYCLE_LEN];
  int nfrozen; uint32_t frozen[MAX_CYCLE_LEN];
  const char* detector;  // which algorithm raised it
  char reason[256];      // human-readable evidence
};
struct OrderResult {
  bool ok = false;
  const char* reason = "";
  int64_t rested = 0, latencyNs = 0;
  ds::DynArray<Trade> trades;
};

struct Hist {  // log2 latency histogram, O(1) add
  uint64_t b[48] = {0}, n = 0, sum = 0, mn = ~0ULL, mx = 0;
  void add(uint64_t ns);
  uint64_t pct(double p) const;  // upper bound of the bucket holding percentile p
};

struct Level {
  int64_t price, qty = 0;
  ds::DList<Order> orders;
  explicit Level(int64_t p) : price(p) {}
};
struct BidBefore { bool operator()(int64_t a, int64_t b) const { return a > b; } };  // max-heap
struct AskBefore { bool operator()(int64_t a, int64_t b) const { return a < b; } };  // min-heap
struct RiskBefore {
  bool operator()(const Alert& a, const Alert& b) const {
    return a.score != b.score ? a.score > b.score : a.seq < b.seq;
  }
};
template <class B>
struct Side {
  ds::HashMap<Level*> lv;   // price -> level (O(1))
  ds::Heap<int64_t, B> h;   // best price on top (O(log n)); stale prices dropped lazily
};
struct Tick { uint64_t ts; int64_t amt; };
struct Window { ds::Deque<Tick> q, mx; int64_t sum = 0; };

class Engine {
 public:
  Engine();
  ~Engine();
  Engine(const Engine&) = delete;
  Engine& operator=(const Engine&) = delete;

  void submitOrder(uint64_t id, uint32_t acct, bool buy, int64_t price, int64_t qty, OrderResult& r);
  bool cancel(uint64_t id);
  const char* transfer(uint32_t from, uint32_t to, int64_t amt);  // nullptr = ok, else reject reason
  void sanction(uint32_t acct);
  bool unfreeze(uint32_t acct);

  void stateJson(std::string& s, int depth);
  void alertsJson(std::string& s);
  void graphJson(std::string& s, int64_t minAmt, uint64_t window);
  void statusJson(std::string& s, uint32_t acct);
  void statsJson(std::string& s);
  void depthQty(int depth, int64_t& bid, int64_t& ask);  // total qty in the top `depth` levels per side

  std::string takeEvents() { std::string t; t.swap(evt_); return t; }

 private:
  using ONode = ds::DList<Order>::Node;

  uint8_t gate(uint32_t acct);
  template <class Opp, class Own> void match(Order& o, Opp& opp, Own& own, OrderResult& r);
  template <class S> void unlink(S& side, ONode* n);
  void pushEvent(uint32_t from, uint32_t to, int64_t amt, bool wire);
  void drainEvents();
  void analyze(const Event& e);
  void searchCycle(uint32_t u, uint32_t v);
  void raise(Alert a);
  void drainRisk();
  void freeze(uint32_t acct);
  uint32_t nodeOf(uint32_t acct);
  void sanctionHit(uint32_t acct);

  // L1
  ds::CountingBloom bloom_;
  ds::HashMap<uint8_t> blocked_;
  // L2
  ds::SpscRing<Order, RING_SIZE> ring_;
  Side<BidBefore> bids_;
  Side<AskBefore> asks_;
  ds::HashMap<ONode*> orders_;
  // L3
  ds::Deque<Event> parts_[PARTS];
  // L4
  ds::HashMap<uint32_t> idx_;
  ds::DynArray<uint32_t> rev_;
  ds::DynCsr g_;
  ds::HashMap<EdgeInfo> edgeW_;
  ds::HashMap<Window*> windows_;
  ds::HashMap<uint64_t> lastStruct_;
  ds::HashMap<uint8_t> cycles_;
  uint64_t tick_ = 0;
  // L5
  ds::Heap<Alert, RiskBefore> risk_;
  ds::HashMap<int64_t> score_;
  Alert hist_[HISTORY];
  uint64_t histN_ = 0, alertSeq_ = 0;

  // stats
  Hist matchH_, amlH_;
  uint64_t nOrders_ = 0, nRejected_ = 0, nTrades_ = 0, nBloomHit_ = 0, nBloomFP_ = 0;
  uint64_t nCancels_ = 0, nPurged_ = 0, nStalePops_ = 0, nEvents_ = 0, nWires_ = 0, nDfsSearches_ = 0, nDfsVisits_ = 0;
  std::string evt_;
};

}  // namespace hft
