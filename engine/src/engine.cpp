#include "engine.h"

#include <chrono>
#include <cstdarg>
#include <cstdio>

namespace hft {

using ds::DynArray;
using ds::HashMap;

static uint64_t nowNs() {
  return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch()).count();
}

static void fmt(std::string& s, const char* f, ...) {
  char buf[1024];
  va_list ap;
  va_start(ap, f);
  int n = vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  if (n > 0) s.append(buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1));
}

// ------------------------------------------------------------------- Hist
void Hist::add(uint64_t ns) {
  int k = 63 - __builtin_clzll(ns | 1);
  if (k > 47) k = 47;
  b[k]++; n++; sum += ns;
  if (ns < mn) mn = ns;
  if (ns > mx) mx = ns;
}
uint64_t Hist::pct(double p) const {
  if (!n) return 0;
  uint64_t target = (uint64_t)(p * (double)n);
  if (target < 1) target = 1;
  uint64_t c = 0;
  for (int k = 0; k < 48; k++) { c += b[k]; if (c >= target) return 1ULL << (k + 1); }
  return mx;
}

// ----------------------------------------------------------------- Engine
Engine::Engine() : g_(32) {}

Engine::~Engine() {
  bids_.lv.forEach([](uint64_t, Level*& l) { delete l; });
  asks_.lv.forEach([](uint64_t, Level*& l) { delete l; });
  windows_.forEach([](uint64_t, Window*& w) { delete w; });
}

// L1: Bloom says "maybe blocked"; the exact hash map confirms (removes false positives).
uint8_t Engine::gate(uint32_t a) {
  nBloomHit_++;
  if (!bloom_.maybe(a)) return 0;
  uint8_t* b = blocked_.find(a);
  if (!b) { nBloomFP_++; return 0; }
  return *b;
}

void Engine::sanctionHit(uint32_t acct) {
  Alert a{};
  a.kind = SANCTION_HIT; a.score = 0; a.tick = tick_; a.n = 1; a.accts[0] = acct;
  a.detector = "L1 counting Bloom filter + exact hash check";
  snprintf(a.reason, sizeof a.reason, "Account %u is on the sanctions list and tried to trade or transfer. Blocked at layer 1 before it reached the order book.", acct);
  raise(a);
  drainRisk();
}

void Engine::sanction(uint32_t acct) {
  uint8_t* b = blocked_.find(acct);
  if (!b) { blocked_.put(acct, SANCTIONED); bloom_.add(acct); }
  else *b = SANCTIONED;
}

void Engine::freeze(uint32_t acct) {
  blocked_.put(acct, FROZEN);
  bloom_.add(acct);
}

bool Engine::unfreeze(uint32_t acct) {
  uint8_t* b = blocked_.find(acct);
  if (!b || *b != FROZEN) return false;
  blocked_.erase(acct);
  bloom_.remove(acct);
  score_.put(acct, 0);
  return true;
}

// L2: order book. Level = FIFO DList of orders; heap tracks best price; hash maps give O(1) lookups.
template <class S>
void Engine::unlink(S& side, ONode* n) {
  int64_t price = n->v.price;
  Level* L = *side.lv.find(price);
  L->qty -= n->v.qty;
  orders_.erase(n->v.id);
  L->orders.erase(n);
  if (!L->orders.n) { side.lv.erase((uint64_t)price); delete L; }
}

template <class Opp, class Own>
void Engine::match(Order& o, Opp& opp, Own& own, OrderResult& r) {
  while (o.qty > 0) {
    while (!opp.h.empty() && !opp.lv.find((uint64_t)opp.h.top())) { opp.h.pop(); nStalePops_++; }  // drop stale prices
    if (opp.h.empty()) break;
    int64_t p = opp.h.top();
    if (o.buy ? p > o.price : p < o.price) break;
    Level* L = *opp.lv.find((uint64_t)p);
    ONode* n = L->orders.head;
    if (blocked_.find(n->v.acct) || n->v.acct == o.acct) { unlink(opp, n); nPurged_++; continue; }  // maker frozen, or self-trade prevention: drop the resting order
    int64_t f = o.qty < n->v.qty ? o.qty : n->v.qty;
    Trade t{n->v.id, o.id, o.buy ? o.acct : n->v.acct, o.buy ? n->v.acct : o.acct, p, f};
    r.trades.push_back(t);
    o.qty -= f;
    n->v.qty -= f;
    L->qty -= f;
    if (t.buyer != t.seller) pushEvent(t.buyer, t.seller, p * f, false);
    if (n->v.qty == 0) {
      orders_.erase(n->v.id);
      L->orders.erase(n);
      if (!L->orders.n) { opp.lv.erase((uint64_t)p); delete L; }
    }
  }
  if (o.qty > 0) {
    Level** pl = own.lv.find((uint64_t)o.price);
    Level* L;
    if (pl) L = *pl;
    else { L = new Level(o.price); own.lv.put((uint64_t)o.price, L); own.h.push(o.price); }
    ONode* nd = L->orders.push_back(o);
    L->qty += o.qty;
    orders_.put(o.id, nd);
    r.rested = o.qty;
  }
}

void Engine::submitOrder(uint64_t id, uint32_t acct, bool buy, int64_t price, int64_t qty, OrderResult& r) {
  uint64_t t0 = nowNs();
  r.ok = false; r.reason = ""; r.rested = 0;
  nOrders_++;
  if (qty <= 0 || price <= 0) { r.reason = "invalid"; nRejected_++; return; }
  if (orders_.find(id)) { r.reason = "duplicate_id"; nRejected_++; return; }
  if (uint8_t g = gate(acct)) {
    r.reason = g == SANCTIONED ? "sanctioned" : "frozen";
    nRejected_++;
    if (g == SANCTIONED) sanctionHit(acct);
    return;
  }
  if (!ring_.push(Order{id, acct, buy, price, qty})) { r.reason = "backpressure"; nRejected_++; return; }
  Order cur;
  while (ring_.pop(cur)) {
    if (cur.buy) match(cur, asks_, bids_, r);
    else match(cur, bids_, asks_, r);
  }
  r.ok = true;
  r.latencyNs = (int64_t)(nowNs() - t0);
  matchH_.add((uint64_t)r.latencyNs);
  nTrades_ += r.trades.size();
  drainEvents();
}

bool Engine::cancel(uint64_t id) {
  ONode** pn = orders_.find(id);
  if (!pn) return false;
  if ((*pn)->v.buy) unlink(bids_, *pn); else unlink(asks_, *pn);
  nCancels_++;
  return true;
}

// L3: partitioned event queues, partition = hash(from account)
void Engine::pushEvent(uint32_t from, uint32_t to, int64_t amt, bool wire) {
  parts_[ds::mix64(from) % PARTS].push_back(Event{from, to, amt, wire});
}

const char* Engine::transfer(uint32_t from, uint32_t to, int64_t amt) {
  if (amt <= 0 || from == to) return "invalid";
  uint8_t g = gate(from);
  uint8_t g2 = g ? g : gate(to);
  if (g2) {
    uint32_t who = g ? from : to;
    if (g2 == SANCTIONED) sanctionHit(who);
    return g2 == SANCTIONED ? "sanctioned" : "frozen";
  }
  pushEvent(from, to, amt, true);
  drainEvents();
  return nullptr;
}

void Engine::drainEvents() {
  uint64_t t0 = nowNs();
  bool any = false;
  for (int p = 0; p < PARTS; p++)
    while (!parts_[p].empty()) {
      Event e = parts_[p].front();
      parts_[p].pop_front();
      analyze(e);
      any = true;
    }
  drainRisk();
  if (any) amlH_.add(nowNs() - t0);
}

// L4: graph analytics
uint32_t Engine::nodeOf(uint32_t acct) {
  if (uint32_t* p = idx_.find(acct)) return *p;
  uint32_t i = (uint32_t)rev_.size();
  rev_.push_back(acct);
  idx_.put(acct, i);
  return i;
}

namespace {
struct CycleSearch {
  const ds::DynCsr& g;
  HashMap<EdgeInfo>& w;
  uint32_t target;
  uint32_t path[MAX_CYCLE_LEN];
  int len = 0, steps = 0;
  bool found = false;
  bool heavy(uint32_t a, uint32_t b) {
    EdgeInfo* x = w.find(((uint64_t)a << 32) | b);
    return x && x->w >= CYCLE_MIN_EDGE;
  }
  void go(uint32_t cur) {  // depth-first, at most MAX_CYCLE_LEN nodes on the cycle
    g.forEachOut(cur, [&](uint32_t nx) {
      if (found || steps >= DFS_BUDGET || !heavy(cur, nx)) return;
      steps++;
      if (nx == target) { if (len >= 2) found = true; return; }  // ignore 2-cycles
      if (len >= MAX_CYCLE_LEN - 1) return;
      for (int i = 0; i < len; i++) if (path[i] == nx) return;
      path[len++] = nx;
      go(nx);
      if (!found) len--;
    });
  }
};
}  // namespace

void Engine::searchCycle(uint32_t u, uint32_t v) {
  CycleSearch cs{g_, edgeW_, u, {0}};
  cs.path[cs.len++] = v;
  nDfsSearches_++;
  cs.go(v);
  nDfsVisits_ += (uint64_t)cs.steps;
  if (!cs.found) return;

  Alert a{};
  a.kind = CYCLE; a.score = SCORE_CYCLE; a.tick = tick_;
  a.detector = "L4 bounded DFS on the CSR graph (k <= 6)";
  a.n = cs.len + 1;
  a.accts[0] = rev_[u];
  for (int i = 0; i < cs.len; i++) a.accts[i + 1] = rev_[cs.path[i]];
  // amount = weakest link; dedupe by the set of accounts
  int64_t mn = edgeW_.find(((uint64_t)u << 32) | cs.path[0])->w;
  for (int i = 0; i < cs.len; i++) {
    uint32_t from = cs.path[i], to = i + 1 < cs.len ? cs.path[i + 1] : u;
    int64_t x = edgeW_.find(((uint64_t)from << 32) | to)->w;
    if (x < mn) mn = x;
  }
  a.amount = mn;
  uint32_t s[MAX_CYCLE_LEN];
  for (int i = 0; i < a.n; i++) s[i] = a.accts[i];
  for (int i = 1; i < a.n; i++) { uint32_t k = s[i]; int j = i - 1; while (j >= 0 && s[j] > k) { s[j + 1] = s[j]; j--; } s[j + 1] = k; }
  uint64_t h = 1469598103934665603ULL;
  for (int i = 0; i < a.n; i++) h = ds::mix64(h ^ s[i]);
  if (cycles_.find(h)) return;
  cycles_.put(h, 1);
  char path[100];
  size_t off = 0;
  for (int i = 0; i < a.n && off < sizeof path - 12; i++) off += (size_t)snprintf(path + off, sizeof path - off, "%u->", a.accts[i]);
  snprintf(path + off, sizeof path - off, "%u", a.accts[0]);
  snprintf(a.reason, sizeof a.reason,
           "Circular flow %s. Every hop moved at least $%lld and the money came back to where it started: layering. Weakest hop $%lld.",
           path, (long long)(CYCLE_MIN_EDGE / 100), (long long)(mn / 100));
  raise(a);
}

void Engine::analyze(const Event& e) {
  nEvents_++;
  if (!e.wire) return;  // exchange trades are cleared on the exchange; only bank wires form the money-flow graph
  nWires_++;
  tick_++;
  uint32_t u = nodeOf(e.from), v = nodeOf(e.to);
  g_.ensureNodes((uint32_t)rev_.size());
  uint64_t key = ((uint64_t)u << 32) | v;
  int64_t total;
  if (EdgeInfo* w = edgeW_.find(key)) { w->w += e.amt; w->tick = tick_; total = w->w; }
  else { g_.addEdge(u, v); edgeW_.put(key, EdgeInfo{e.amt, tick_}); total = e.amt; }
  if (total >= CYCLE_MIN_EDGE) searchCycle(u, v);

  // structuring ("smurfing"): sliding window per receiver.
  // Deque q = window contents (count + sum); monotonic deque mx = window max in O(1).
  Window** pw = windows_.find(e.to);
  Window* W;
  if (pw) W = *pw; else { W = new Window(); windows_.put(e.to, W); }
  while (!W->q.empty() && W->q.front().ts + STRUCT_WINDOW <= tick_) { W->sum -= W->q.front().amt; W->q.pop_front(); }
  while (!W->mx.empty() && W->mx.front().ts + STRUCT_WINDOW <= tick_) W->mx.pop_front();
  Tick tk{tick_, e.amt};
  W->q.push_back(tk);
  W->sum += e.amt;
  while (!W->mx.empty() && W->mx.back().amt <= e.amt) W->mx.pop_back();
  W->mx.push_back(tk);
  if ((int)W->q.size() >= STRUCT_MIN_COUNT && W->mx.front().amt < REPORT_THRESHOLD && W->sum >= REPORT_THRESHOLD) {
    uint64_t* last = lastStruct_.find(e.to);
    if (!last || tick_ - *last >= STRUCT_WINDOW) {
      lastStruct_.put(e.to, tick_);
      Alert a{};
      a.kind = STRUCTURING; a.score = SCORE_STRUCT; a.tick = tick_; a.amount = W->sum;
      a.n = 1; a.accts[0] = e.to;
      a.detector = "L4 sliding window + monotonic deque";
      snprintf(a.reason, sizeof a.reason,
               "%d wires into account %u within the last %llu wires, each under $%lld (largest $%lld) but totalling $%lld: structuring (smurfing) to dodge the reporting limit.",
               (int)W->q.size(), e.to, (unsigned long long)STRUCT_WINDOW, (long long)(REPORT_THRESHOLD / 100),
               (long long)(W->mx.front().amt / 100), (long long)(W->sum / 100));
      raise(a);
    }
  }
}

// L5: risk priority queue (highest score first). Applying an alert may freeze accounts,
// which feeds straight back into the L1 gatekeeper.
void Engine::raise(Alert a) { a.seq = ++alertSeq_; risk_.push(a); }

static void alertJson(std::string& s, const Alert& a) {
  static const char* kinds[] = {"cycle", "structuring", "sanction_hit"};
  fmt(s, "{\"seq\":%llu,\"kind\":\"%s\",\"score\":%d,\"amount\":%lld,\"tick\":%llu,\"accounts\":[",
      (unsigned long long)a.seq, kinds[a.kind], a.score, (long long)a.amount, (unsigned long long)a.tick);
  for (int i = 0; i < a.n; i++) fmt(s, "%s%u", i ? "," : "", a.accts[i]);
  fmt(s, "],\"frozen\":[");
  for (int i = 0; i < a.nfrozen; i++) fmt(s, "%s%u", i ? "," : "", a.frozen[i]);
  fmt(s, "],\"detector\":\"%s\",\"reason\":\"%s\"}", a.detector ? a.detector : "", a.reason);
}

void Engine::drainRisk() {
  while (!risk_.empty()) {
    Alert a = risk_.top();
    risk_.pop();
    a.nfrozen = 0;
    if (a.score > 0)
      for (int i = 0; i < a.n; i++) {
        int64_t* sp = score_.find(a.accts[i]);
        int64_t ns = (sp ? *sp : 0) + a.score;
        score_.put(a.accts[i], ns);
        if (ns >= FREEZE_THRESHOLD && !blocked_.find(a.accts[i])) {
          freeze(a.accts[i]);
          a.frozen[a.nfrozen++] = a.accts[i];
        }
      }
    hist_[histN_++ % HISTORY] = a;
    evt_ += "EVT ";
    alertJson(evt_, a);
    evt_ += "\n";
  }
}

// ----------------------------------------------------------------- JSON
template <class S>
static void levelsJson(std::string& s, S& side, int depth) {
  auto h = side.h;  // copy, then pop: top-N levels without disturbing the live heap
  int64_t last = -1;
  int c = 0;
  s += "[";
  while (!h.empty() && c < depth) {
    int64_t p = h.top();
    h.pop();
    if (p == last) continue;
    Level** L = side.lv.find((uint64_t)p);
    if (!L) continue;
    last = p;
    fmt(s, "%s{\"price\":%lld,\"qty\":%lld,\"orders\":%zu}", c ? "," : "", (long long)p, (long long)(*L)->qty, (*L)->orders.n);
    c++;
  }
  s += "]";
}

void Engine::stateJson(std::string& s, int depth) {
  s += "{\"bids\":";
  levelsJson(s, bids_, depth);
  s += ",\"asks\":";
  levelsJson(s, asks_, depth);
  fmt(s, ",\"resting\":%zu}", orders_.size());
}

void Engine::depthQty(int depth, int64_t& bid, int64_t& ask) {
  auto sum = [&](auto& side) {
    auto h = side.h;  // copy, pop the top levels
    int64_t last = -1, tot = 0;
    int c = 0;
    while (!h.empty() && c < depth) {
      int64_t p = h.top();
      h.pop();
      if (p == last) continue;
      Level** L = side.lv.find((uint64_t)p);
      if (!L) continue;
      last = p; tot += (*L)->qty; c++;
    }
    return tot;
  };
  bid = sum(bids_);
  ask = sum(asks_);
}

void Engine::alertsJson(std::string& s) {
  s += "[";
  uint64_t n = histN_ < HISTORY ? histN_ : HISTORY;
  for (uint64_t i = 0; i < n; i++) {
    if (i) s += ",";
    alertJson(s, hist_[(histN_ - 1 - i) % HISTORY]);
  }
  s += "]";
}

void Engine::graphJson(std::string& s, int64_t minAmt, uint64_t window) {
  std::string edges, nodes;
  HashMap<uint8_t> seen;
  int ne = 0, nn = 0;
  auto addNode = [&](uint32_t acct) {
    if (seen.find(acct)) return;
    seen.put(acct, 1);
    uint8_t* b = blocked_.find(acct);
    int64_t* sc = score_.find(acct);
    fmt(nodes, "%s{\"account\":%u,\"state\":\"%s\",\"score\":%lld}", nn++ ? "," : "", acct,
        !b ? "ok" : (*b == SANCTIONED ? "sanctioned" : "frozen"), (long long)(sc ? *sc : 0));
  };
  edgeW_.forEach([&](uint64_t key, EdgeInfo& ei) {
    int64_t w = ei.w;
    if (w < minAmt || ne >= 400 || (window && tick_ - ei.tick > window)) return;
    uint32_t from = rev_[(size_t)(key >> 32)], to = rev_[(size_t)(key & 0xffffffffu)];
    fmt(edges, "%s{\"from\":%u,\"to\":%u,\"amount\":%lld}", ne++ ? "," : "", from, to, (long long)w);
    addNode(from);
    addNode(to);
  });
  s += "{\"nodes\":[" + nodes + "],\"edges\":[" + edges + "]}";
}

void Engine::statusJson(std::string& s, uint32_t acct) {
  uint8_t* b = blocked_.find(acct);
  int64_t* sc = score_.find(acct);
  fmt(s, "{\"account\":%u,\"state\":\"%s\",\"score\":%lld}", acct,
      !b ? "ok" : (*b == SANCTIONED ? "sanctioned" : "frozen"), (long long)(sc ? *sc : 0));
}

static void histJson(std::string& s, const Hist& h) {
  fmt(s, "{\"count\":%llu,\"min_ns\":%llu,\"avg_ns\":%llu,\"p50_ns\":%llu,\"p99_ns\":%llu,\"max_ns\":%llu}",
      (unsigned long long)h.n, (unsigned long long)(h.n ? h.mn : 0),
      (unsigned long long)(h.n ? h.sum / h.n : 0), (unsigned long long)h.pct(0.50),
      (unsigned long long)h.pct(0.99), (unsigned long long)h.mx);
}

void Engine::statsJson(std::string& s) {
  s += "{\"match\":";
  histJson(s, matchH_);
  s += ",\"aml\":";
  histJson(s, amlH_);
  size_t bl = bids_.lv.size(), al = asks_.lv.size();
  fmt(s, ",\"orders\":%llu,\"rejected\":%llu,\"trades\":%llu,\"resting\":%zu,\"bid_levels\":%zu,\"ask_levels\":%zu",
      (unsigned long long)nOrders_, (unsigned long long)nRejected_, (unsigned long long)nTrades_,
      orders_.size(), bl, al);
  fmt(s, ",\"bloom\":{\"slots\":%zu,\"non_zero\":%zu,\"checks\":%llu,\"false_positives\":%llu}",
      bloom_.slots(), bloom_.nonZero(), (unsigned long long)nBloomHit_, (unsigned long long)nBloomFP_);
  fmt(s, ",\"graph\":{\"nodes\":%zu,\"edges\":%zu,\"pending\":%zu}", rev_.size(), edgeW_.size(), g_.pendingSize());
  fmt(s, ",\"algo\":{\"cancels\":%llu,\"purged\":%llu,\"stale_pops\":%llu,\"events\":%llu,\"wires\":%llu,\"dfs_searches\":%llu,\"dfs_visits\":%llu,\"csr_rebuilds\":%zu,\"alerts\":%llu}",
      (unsigned long long)nCancels_, (unsigned long long)nPurged_, (unsigned long long)nStalePops_, (unsigned long long)nEvents_,
      (unsigned long long)nWires_, (unsigned long long)nDfsSearches_, (unsigned long long)nDfsVisits_, g_.rebuilds(), (unsigned long long)alertSeq_);
  s += ",\"blocked\":[";
  int c = 0;
  blocked_.forEach([&](uint64_t k, uint8_t& v) {
    fmt(s, "%s{\"account\":%llu,\"state\":\"%s\"}", c++ ? "," : "", (unsigned long long)k, v == SANCTIONED ? "sanctioned" : "frozen");
  });
  s += "]}";
}

}  // namespace hft
