// Market simulator that runs entirely inside the C++ process.
//   market makers  (accounts 1001-1004): refresh two-sided quotes, cancel stale ones
//   HFT bots       (accounts 2001-2004): momentum takers + quote-and-cancel flickering
//   retail         (accounts 3001-3060): random limit orders, some marketable
//   criminals      (accounts >= 80000):  scripted smurfing / layering-cycle / sanctions rings
// Every message goes through the same Engine API a real client would use.
#pragma once
#include <string>

#include "ds.h"
#include "engine.h"
#include "signals.h"

namespace hft {

struct TradeRec { int64_t price, qty; uint32_t buyer, seller; };
struct WireRec { uint32_t from, to; int64_t amt; uint8_t status; const char* note; };
struct Counters { uint64_t orders = 0, cancels = 0, trades = 0, volume = 0, wires = 0, blocked = 0; };

class Sim {
 public:
  explicit Sim(Engine& e, uint64_t seed = 88172645463325252ULL) : e_(e), rng_(seed) {}
  // Runs `steps` simulation steps. launderEvery = steps between criminal scenarios (0 = none),
  // pace = steps between actions inside a scenario. Writes one JSON object.
  void run(int steps, int launderEvery, int pace, std::string& out);
  void statsJson(std::string& out) const;
  void signalJson(std::string& out) const { sig_.json(out); }

 private:
  uint64_t next() { rng_ ^= rng_ << 13; rng_ ^= rng_ >> 7; rng_ ^= rng_ << 17; return rng_; }
  void step(bool launder, int every, int pace);
  void mm();
  void hft();
  void retail();
  bool place(uint32_t acct, bool buy, int64_t price, int64_t qty, int kind);
  void cancelId(uint64_t id);
  void wire(uint32_t from, uint32_t to, int64_t amt);
  void probe(uint32_t acct);
  void launderTick(int every, int pace);
  void scenarioAction();

  Engine& e_;
  uint64_t rng_, nextId_ = 2000000000ULL, lastId_ = 0;
  int64_t fair_ = 10000, last_ = 10000, lastRested_ = 0;
  const char* lastReason_ = "";
  OrderResult r_;
  ds::Deque<uint64_t> quotes_, retail_;
  ds::DynArray<TradeRec> trades_;
  ds::DynArray<WireRec> wires_;
  Counters bat_, tot_;
  Signals sig_;
  double buyAcc_ = 0, sellAcc_ = 0;
  int sinceBar_ = 0;
  uint64_t flow_[4][4] = {{0}};  // batch trade volume: [buyer kind][seller kind]
  uint64_t kindOrders_[4] = {0, 0, 0, 0}, steps_ = 0, totalNs_ = 0, totalOps_ = 0, lastOps_ = 0, lastNs_ = 0;
  int kind_ = 0, stage_ = 0, idle_ = 0, gap_ = 0, scen_ = 0;
  uint32_t base_ = 0;
};

}  // namespace hft
