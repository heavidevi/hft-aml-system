#include "sim.h"

#include <chrono>
#include <cstdarg>
#include <cstdio>

namespace hft {

static uint64_t nowNs() {
  return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch()).count();
}
static void fmt(std::string& s, const char* f, ...) {
  char buf[512];
  va_list ap;
  va_start(ap, f);
  int n = vsnprintf(buf, sizeof buf, f, ap);
  va_end(ap);
  if (n > 0) s.append(buf, (size_t)(n < (int)sizeof buf ? n : (int)sizeof buf - 1));
}

static int kindIdx(uint32_t a) {  // 0 MM, 1 HFT, 2 retail, 3 other/criminal
  return (a >= 1000 && a < 1100) ? 0 : (a >= 2000 && a < 2100) ? 1 : (a >= 3000 && a < 4000) ? 2 : 3;
}

bool Sim::place(uint32_t acct, bool buy, int64_t price, int64_t qty, int kind) {
  uint64_t id = nextId_++;
  r_.trades.clear();
  e_.submitOrder(id, acct, buy, price, qty, r_);
  bat_.orders++; tot_.orders++; kindOrders_[kind]++;
  for (size_t i = 0; i < r_.trades.size(); i++) {
    const Trade& t = r_.trades[i];
    bat_.trades++; tot_.trades++;
    bat_.volume += (uint64_t)t.qty; tot_.volume += (uint64_t)t.qty;
    last_ = t.price;
    flow_[kindIdx(t.buyer)][kindIdx(t.seller)] += (uint64_t)t.qty;
    (buy ? buyAcc_ : sellAcc_) += (double)t.qty;  // the incoming order is the aggressor
    if (trades_.size() < 24) trades_.push_back(TradeRec{t.price, t.qty, t.buyer, t.seller});
  }
  if (!r_.ok) { bat_.blocked++; tot_.blocked++; }
  lastId_ = id; lastRested_ = r_.rested; lastReason_ = r_.reason;
  return r_.ok;
}

void Sim::cancelId(uint64_t id) {
  if (e_.cancel(id)) { bat_.cancels++; tot_.cancels++; }
}

void Sim::mm() {  // market maker: keep two-sided quotes fresh, cancel the oldest
  uint32_t acct = 1001 + (uint32_t)(next() % 4);
  if (quotes_.size() >= 12)
    for (int i = 0; i < 2; i++) { cancelId(quotes_.front()); quotes_.pop_front(); }
  int64_t half = 1 + (int64_t)(next() % 2), qty = 5 + (int64_t)(next() % 15);
  place(acct, true, fair_ - half, qty, 0);
  if (lastRested_ > 0) quotes_.push_back(lastId_);
  place(acct, false, fair_ + half, qty, 0);
  if (lastRested_ > 0) quotes_.push_back(lastId_);
}

void Sim::hft() {  // HFT: momentum taker when price lags fair value, otherwise flicker quotes
  uint32_t acct = 2001 + (uint32_t)(next() % 4);
  int64_t sig = fair_ - last_, qty = 1 + (int64_t)(next() % 5);
  if (sig >= 1) place(acct, true, fair_ + 1 + (int64_t)(next() % 2), qty, 1);
  else if (sig <= -1) place(acct, false, fair_ - 1 - (int64_t)(next() % 2), qty, 1);
  else {
    bool buy = next() & 1;
    place(acct, buy, buy ? fair_ - 3 : fair_ + 3, qty, 1);
    if (lastRested_ > 0) cancelId(lastId_);  // fleeting liquidity: quote and pull
  }
}

void Sim::retail() {
  uint32_t acct = 3001 + (uint32_t)(next() % 60);
  bool buy = next() & 1, aggressive = next() % 5 == 0;
  int64_t off = (int64_t)(next() % 8);
  int64_t price = aggressive ? (buy ? fair_ + 3 : fair_ - 3) : (buy ? fair_ - off : fair_ + off);
  place(acct, buy, price, 1 + (int64_t)(next() % 10), 2);
  if (lastRested_ > 0) {
    retail_.push_back(lastId_);
    if (retail_.size() > 600) { cancelId(retail_.front()); retail_.pop_front(); }
  }
}

void Sim::wire(uint32_t from, uint32_t to, int64_t amt) {
  const char* why = e_.transfer(from, to, amt);
  bat_.wires++; tot_.wires++;
  if (why) { bat_.blocked++; tot_.blocked++; }
  if (wires_.size() < 24) wires_.push_back(WireRec{from, to, amt, (uint8_t)(why ? 1 : 0), why ? why : "ok"});
}

void Sim::probe(uint32_t acct) {  // the criminal tries to keep trading after being flagged
  place(acct, true, fair_, 1, 3);
  if (wires_.size() < 24) wires_.push_back(WireRec{acct, 0, 0, (uint8_t)(r_.ok ? 0 : 1), r_.ok ? "order ok" : lastReason_});
}

void Sim::scenarioAction() {
  bool done = false;
  switch (kind_) {
    case 1:  // smurfing: six mules each send $9,000 (under the $10k limit) to one collector
      if (stage_ < 6) wire(base_ + 1 + (uint32_t)stage_, base_, 900000);
      else { probe(base_); done = true; }
      break;
    case 2:  // layering: $60k travels a 4-account loop and returns to its origin
      if (stage_ < 4) wire(base_ + 1 + (uint32_t)stage_, base_ + 1 + (uint32_t)((stage_ + 1) % 4), 6000000);
      else { probe(base_ + 1); done = true; }
      break;
    case 3:  // sanctioned account tries to trade and wire money
      if (stage_ == 0) e_.sanction(base_ + 1);
      else if (stage_ == 1) probe(base_ + 1);
      else { wire(base_ + 1, base_ + 2, 100000); done = true; }
      break;
  }
  if (done) { kind_ = 0; stage_ = 0; idle_ = 0; scen_++; } else stage_++;
}

void Sim::launderTick(int every, int pace) {
  if (kind_ == 0) {
    if (++idle_ < every) return;
    kind_ = 1 + scen_ % 3; stage_ = 0; base_ = 80000 + (uint32_t)scen_ * 20; gap_ = pace - 1; idle_ = 0;
  }
  if (++gap_ < pace) return;
  gap_ = 0;
  scenarioAction();
}

void Sim::step(bool launder, int every, int pace) {
  uint64_t r = next();
  switch (r % 8) { case 0: fair_--; break; case 1: fair_++; break; default: break; }
  if (fair_ < 9000) fair_ = 9000;
  if (fair_ > 11000) fair_ = 11000;
  uint64_t a = (r >> 8) % 100;
  if (a < 30) mm(); else if (a < 60) hft(); else retail();
  if (launder) launderTick(every, pace);
  steps_++;
  if (++sinceBar_ >= 20) {  // close a bar: feed the indicators
    int64_t bd, ad;
    e_.depthQty(5, bd, ad);
    sig_.addBar((double)last_, buyAcc_, sellAcc_, (double)bd, (double)ad);
    buyAcc_ = sellAcc_ = 0; sinceBar_ = 0;
  }
}

void Sim::run(int steps, int launderEvery, int pace, std::string& out) {
  bat_ = Counters{};
  for (auto& row : flow_) for (auto& v : row) v = 0;
  trades_.clear();
  wires_.clear();
  if (pace < 1) pace = 1;
  uint64_t t0 = nowNs();
  for (int i = 0; i < steps; i++) step(launderEvery > 0, launderEvery, pace);
  uint64_t ns = nowNs() - t0;
  uint64_t ops = bat_.orders + bat_.cancels + bat_.wires;
  totalNs_ += ns; totalOps_ += ops; lastOps_ = ops; lastNs_ = ns;
  static const char* names[] = {"none", "smurf", "cycle", "sanction"};
  fmt(out, "{\"steps\":%d,\"batch_ns\":%llu,\"ops\":%llu,\"ops_per_sec\":%llu,\"avg_ns_per_op\":%llu,",
      steps, (unsigned long long)ns, (unsigned long long)ops,
      (unsigned long long)(ns ? ops * 1000000000ULL / ns : 0), (unsigned long long)(ops ? ns / ops : 0));
  fmt(out, "\"fair\":%lld,\"last_price\":%lld,\"scenario\":\"%s\",\"stage\":%d,",
      (long long)fair_, (long long)last_, names[kind_], stage_);
  fmt(out, "\"batch\":{\"orders\":%llu,\"cancels\":%llu,\"trades\":%llu,\"volume\":%llu,\"wires\":%llu,\"blocked\":%llu},",
      (unsigned long long)bat_.orders, (unsigned long long)bat_.cancels, (unsigned long long)bat_.trades,
      (unsigned long long)bat_.volume, (unsigned long long)bat_.wires, (unsigned long long)bat_.blocked);
  fmt(out, "\"agent_orders\":{\"mm\":%llu,\"hft\":%llu,\"retail\":%llu,\"criminal\":%llu},\"recent_trades\":[",
      (unsigned long long)kindOrders_[0], (unsigned long long)kindOrders_[1], (unsigned long long)kindOrders_[2], (unsigned long long)kindOrders_[3]);
  for (size_t i = 0; i < trades_.size(); i++)
    fmt(out, "%s{\"price\":%lld,\"qty\":%lld,\"buyer\":%u,\"seller\":%u}", i ? "," : "",
        (long long)trades_[i].price, (long long)trades_[i].qty, trades_[i].buyer, trades_[i].seller);
  out += "],\"recent_wires\":[";
  for (size_t i = 0; i < wires_.size(); i++)
    fmt(out, "%s{\"from\":%u,\"to\":%u,\"amount\":%lld,\"status\":\"%s\",\"note\":\"%s\"}", i ? "," : "",
        wires_[i].from, wires_[i].to, (long long)wires_[i].amt, wires_[i].status ? "blocked" : "ok", wires_[i].note);
  out += "],\"flow\":[";
  for (int b = 0; b < 4; b++) {
    out += b ? ",[" : "[";
    for (int s = 0; s < 4; s++) fmt(out, "%s%llu", s ? "," : "", (unsigned long long)flow_[b][s]);
    out += "]";
  }
  out += "],\"signal\":";
  sig_.json(out);
  out += "}";
}

void Sim::statsJson(std::string& out) const {
  fmt(out, "{\"steps\":%llu,\"orders\":%llu,\"cancels\":%llu,\"trades\":%llu,\"volume\":%llu,\"wires\":%llu,\"blocked\":%llu,",
      (unsigned long long)steps_, (unsigned long long)tot_.orders, (unsigned long long)tot_.cancels, (unsigned long long)tot_.trades,
      (unsigned long long)tot_.volume, (unsigned long long)tot_.wires, (unsigned long long)tot_.blocked);
  fmt(out, "\"last_ops_per_sec\":%llu,\"avg_ns_per_op\":%llu,\"fair\":%lld,\"last_price\":%lld,",
      (unsigned long long)(lastNs_ ? lastOps_ * 1000000000ULL / lastNs_ : 0),
      (unsigned long long)(totalOps_ ? totalNs_ / totalOps_ : 0), (long long)fair_, (long long)last_);
  fmt(out, "\"agent_orders\":{\"mm\":%llu,\"hft\":%llu,\"retail\":%llu,\"criminal\":%llu}}",
      (unsigned long long)kindOrders_[0], (unsigned long long)kindOrders_[1], (unsigned long long)kindOrders_[2], (unsigned long long)kindOrders_[3]);
}

}  // namespace hft
