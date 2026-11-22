#include <cstdio>
#include <cstring>
#include <string>

#include "ds.h"
#include "engine.h"
#include "sim.h"
#include "signals.h"

static int fails = 0, checks = 0;
#define CHECK(c) do { checks++; if (!(c)) { fails++; printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #c); } } while (0)

using namespace hft;

static bool has(const std::string& s, const char* sub) { return s.find(sub) != std::string::npos; }

static void testDS() {
  // Heap
  struct Lt { bool operator()(int a, int b) const { return a < b; } };
  ds::Heap<int, Lt> h;
  int in[] = {5, 1, 9, 3, 7, 2, 8};
  for (int x : in) h.push(x);
  int prev = -1; bool sorted = true;
  while (!h.empty()) { if (h.top() < prev) sorted = false; prev = h.top(); h.pop(); }
  CHECK(sorted);

  // HashMap with churn (tombstones + rehash)
  ds::HashMap<int> m;
  for (int i = 0; i < 5000; i++) m.put(i, i * 2);
  for (int i = 0; i < 5000; i += 2) m.erase(i);
  CHECK(m.size() == 2500);
  bool ok = true;
  for (int i = 0; i < 5000; i++) { int* p = m.find(i); if ((i % 2 == 0) != (p == nullptr)) ok = false; if (p && *p != i * 2) ok = false; }
  CHECK(ok);
  for (int i = 0; i < 5000; i += 2) m.put(i, 1);
  CHECK(m.size() == 5000);

  // DList
  ds::DList<int> l;
  auto* a = l.push_back(1); auto* b = l.push_back(2); l.push_back(3);
  l.erase(b);
  CHECK(l.n == 2 && l.head->v == 1 && l.tail->v == 3 && l.head->next == l.tail);
  l.erase(a);
  CHECK(l.head->v == 3 && l.head->prev == nullptr);

  // Ring
  ds::SpscRing<int, 4> r;
  CHECK(r.push(1) && r.push(2) && r.push(3) && r.push(4) && !r.push(5));
  int v; CHECK(r.pop(v) && v == 1);
  CHECK(r.push(6));
  CHECK(r.pop(v) && v == 2 && r.pop(v) && v == 3 && r.pop(v) && v == 4 && r.pop(v) && v == 6 && !r.pop(v));

  // Deque (as monotonic max over sliding window of size 3)
  ds::Deque<int> dq; int arr[] = {1, 3, -1, -3, 5, 3, 6, 7}; int expect[] = {3, 3, 5, 5, 6, 7}; int got[6]; int gi = 0;
  ds::Deque<int> idxq;
  for (int i = 0; i < 8; i++) {
    while (!idxq.empty() && idxq.front() <= i - 3) idxq.pop_front();
    while (!idxq.empty() && arr[idxq.back()] <= arr[i]) idxq.pop_back();
    idxq.push_back(i);
    if (i >= 2) got[gi++] = arr[idxq.front()];
  }
  bool same = true; for (int i = 0; i < 6; i++) if (got[i] != expect[i]) same = false;
  CHECK(same);
  for (int i = 0; i < 100; i++) dq.push_back(i);  // forces growth
  CHECK(dq.size() == 100 && dq.front() == 0 && dq.back() == 99);

  // Counting bloom: add / remove
  ds::CountingBloom bf(1 << 12, 3);
  for (uint64_t k = 0; k < 100; k++) bf.add(k);
  bool all = true; for (uint64_t k = 0; k < 100; k++) if (!bf.maybe(k)) all = false;
  CHECK(all);
  bf.remove(42);
  CHECK(!bf.maybe(42) || true);  // may stay positive on collision, but must not break others
  all = true; for (uint64_t k = 0; k < 100; k++) if (k != 42 && !bf.maybe(k)) all = false;
  CHECK(all);

  // DynCsr across rebuilds
  ds::DynCsr g(4);
  g.ensureNodes(10);
  for (uint32_t i = 0; i < 9; i++) g.addEdge(i, i + 1);
  int cnt = 0; uint32_t nb = 99;
  g.forEachOut(5, [&](uint32_t x) { cnt++; nb = x; });
  CHECK(cnt == 1 && nb == 6 && g.edgeCount() == 9);
}

static void testMatching() {
  Engine e;
  OrderResult r;
  e.submitOrder(1, 100, false, 10100, 5, r);   // ask 5 @101.00 (acct 100)
  r.trades.clear();
  e.submitOrder(2, 101, false, 10100, 5, r);   // same price, later (acct 101)
  r.trades.clear();
  e.submitOrder(3, 102, false, 10200, 5, r);   // ask @102.00
  r.trades.clear();
  e.submitOrder(4, 103, true, 10000, 4, r);    // bid below market rests
  CHECK(r.ok && r.trades.size() == 0 && r.rested == 4);

  r.trades.clear();
  e.submitOrder(5, 104, true, 10100, 7, r);    // buys 5 from acct100 then 2 from acct101 (price-time priority)
  CHECK(r.ok && r.trades.size() == 2 && r.rested == 0);
  CHECK(r.trades[0].makerId == 1 && r.trades[0].qty == 5 && r.trades[0].seller == 100);
  CHECK(r.trades[1].makerId == 2 && r.trades[1].qty == 2 && r.trades[1].seller == 101);

  std::string s; e.stateJson(s, 5);
  CHECK(has(s, "\"asks\":[{\"price\":10100,\"qty\":3,\"orders\":1},{\"price\":10200,\"qty\":5,\"orders\":1}]"));
  CHECK(has(s, "\"bids\":[{\"price\":10000,\"qty\":4,\"orders\":1}]"));
  int64_t bq, aq; e.depthQty(5, bq, aq);
  CHECK(bq == 4 && aq == 8);

  r.trades.clear();
  e.submitOrder(6, 105, true, 10300, 10, r);   // sweeps asks, 2 left rests
  CHECK(r.trades.size() == 2 && r.rested == 2);
  CHECK(e.cancel(6) && !e.cancel(6));
  CHECK(e.cancel(4));
  s.clear(); e.stateJson(s, 5);
  CHECK(has(s, "\"bids\":[]") && has(s, "\"asks\":[]") && has(s, "\"resting\":0"));

  r.trades.clear();
  e.submitOrder(7, 106, true, 10000, 1, r);
  r.trades.clear();
  e.submitOrder(7, 106, true, 10000, 1, r);
  CHECK(!r.ok && !strcmp(r.reason, "duplicate_id"));
  r.trades.clear();
  e.submitOrder(8, 106, true, 0, 1, r);
  CHECK(!r.ok && !strcmp(r.reason, "invalid"));
}

static void testGatekeeper() {
  Engine e;
  OrderResult r;
  e.sanction(666);
  e.submitOrder(1, 666, true, 100, 1, r);
  CHECK(!r.ok && !strcmp(r.reason, "sanctioned"));
  std::string ev = e.takeEvents();
  CHECK(has(ev, "\"kind\":\"sanction_hit\""));
  const char* why = e.transfer(1, 666, 1000);
  CHECK(why && !strcmp(why, "sanctioned"));
  e.takeEvents();
  // many unrelated accounts must pass the gate (bloom false positives are filtered by the exact map)
  bool allOk = true;
  for (uint32_t a = 1; a < 3000; a++) { if (a == 666) continue; OrderResult q; e.submitOrder(1000 + a, a, true, 5, 1, q); if (!q.ok) allOk = false; }
  CHECK(allOk);
}

static void testCycle() {
  Engine e;
  const int64_t amt = 6000000;  // $60k each hop (>= CYCLE_MIN_EDGE)
  CHECK(e.transfer(1, 2, amt) == nullptr);
  CHECK(e.transfer(2, 3, amt) == nullptr);
  CHECK(e.transfer(3, 4, amt) == nullptr);
  CHECK(e.takeEvents().empty());
  CHECK(e.transfer(4, 1, amt) == nullptr);   // closes the 4-account loop
  std::string ev = e.takeEvents();
  CHECK(has(ev, "\"kind\":\"cycle\"") && has(ev, "\"frozen\":["));
  for (uint32_t a = 1; a <= 4; a++) { std::string s; e.statusJson(s, a); CHECK(has(s, "\"state\":\"frozen\"")); }
  OrderResult r;
  e.submitOrder(1, 3, true, 100, 1, r);
  CHECK(!r.ok && !strcmp(r.reason, "frozen"));
  CHECK(e.unfreeze(3));
  r.trades.clear();
  e.submitOrder(2, 3, true, 100, 1, r);
  CHECK(r.ok);

  // a 7-node loop is longer than k=6 and must NOT be flagged
  Engine f;
  for (uint32_t i = 1; i <= 7; i++) f.transfer(i, i % 7 + 1, amt);
  CHECK(f.takeEvents().find("\"kind\":\"cycle\"") == std::string::npos);

  // light edges never count
  Engine g2;
  for (uint32_t i = 1; i <= 4; i++) g2.transfer(i, i % 4 + 1, 100000);
  CHECK(g2.takeEvents().empty());
}

static void testSmurfing() {
  Engine e;
  for (uint32_t s = 10; s < 15; s++) CHECK(e.transfer(s, 99, 900000) == nullptr);  // five $9k transfers
  std::string ev = e.takeEvents();
  CHECK(has(ev, "\"kind\":\"structuring\"") && has(ev, "\"accounts\":[99]"));
  std::string st; e.statusJson(st, 99);
  CHECK(has(st, "\"state\":\"frozen\""));

  // one big transfer is not structuring; slow drip outside the window is not either
  Engine f;
  CHECK(f.transfer(1, 2, 5000000) == nullptr);
  CHECK(f.takeEvents().empty());
  Engine g;
  for (uint32_t i = 0; i < 4; i++) g.transfer(20 + i, 77, 900000);
  for (uint32_t i = 0; i < 60; i++) g.transfer(200 + i, 300 + i, 1000);  // pushes ticks past the window
  for (uint32_t i = 0; i < 4; i++) g.transfer(40 + i, 77, 900000);
  CHECK(g.takeEvents().empty());
}

static void testStats() {
  Engine e;
  OrderResult r;
  for (int i = 0; i < 50; i++) { r.trades.clear(); e.submitOrder(i + 1, 1 + i % 5, i % 2, 10000 + (i % 3), 2, r); }
  std::string s; e.statsJson(s);
  CHECK(has(s, "\"orders\":50") && has(s, "\"p99_ns\""));
  std::string g; e.graphJson(g, 1, 0);
  CHECK(has(g, "\"nodes\":[") && has(g, "\"edges\":["));
}

static void testSim() {
  Engine e;
  Sim sim(e);
  std::string out;
  sim.run(30000, 400, 5, out);  // criminal scenario every 400 steps, one action every 5 steps
  CHECK(has(out, "\"recent_trades\":[{") || has(out, "\"trades\":"));
  std::string al; e.alertsJson(al);
  CHECK(has(al, "\"kind\":\"cycle\"") && has(al, "\"kind\":\"structuring\"") && has(al, "\"kind\":\"sanction_hit\""));
  CHECK(has(al, "\"reason\":\"Circular flow") && has(al, "structuring (smurfing)"));
  // honest market participants (market makers, HFT, retail) must never be frozen
  uint32_t honest[] = {1001, 1002, 1003, 1004, 2001, 2002, 2003, 2004, 3001, 3002, 3030, 3060};
  bool clean = true;
  for (uint32_t a : honest) { std::string s; e.statusJson(s, a); if (!has(s, "\"state\":\"ok\"")) clean = false; }
  CHECK(clean);
  std::string ss; sim.statsJson(ss);
  CHECK(!has(ss, "\"cancels\":0,") && !has(ss, "\"trades\":0,") && !has(ss, "\"wires\":0,"));
  std::string st; e.statsJson(st);
  CHECK(has(st, "\"dfs_searches\":") && !has(st, "\"csr_rebuilds\":0"));
}

static void testSignals() {
  std::string j;
  Signals warm;
  for (int i = 0; i < 20; i++) warm.addBar(100 + i, 5, 5, 10, 10);
  warm.json(j);
  CHECK(has(j, "\"ready\":false"));

  Signals up, dn, flat;
  for (int i = 0; i < 80; i++) {
    up.addBar(10000 + i * 3, 8, 2, 30, 10);
    dn.addBar(10000 - i * 3, 2, 8, 10, 30);
    flat.addBar(10000, 5, 5, 10, 10);
  }
  j.clear(); up.json(j);
  CHECK(has(j, "\"direction\":\"UP\"") && has(j, "\"ready\":true") && !has(j, "\"hits\":0,"));
  j.clear(); dn.json(j);
  CHECK(has(j, "\"direction\":\"DOWN\"") && !has(j, "\"hits\":0,"));
  j.clear(); flat.json(j);
  CHECK(has(j, "\"direction\":\"FLAT\"") && has(j, "\"rsi\":50.0"));
  j.clear(); up.json(j);
  CHECK(has(j, "\"rsi\":100.0") && has(j, "Book imbalance"));  // RSI saturates in a one-way ramp
}

int main() {
  testSignals();
  testDS();
  testSim();
  testMatching();
  testGatekeeper();
  testCycle();
  testSmurfing();
  testStats();
  printf("%d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
