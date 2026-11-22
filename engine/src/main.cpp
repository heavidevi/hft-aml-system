// Line protocol (one command per line on stdin, one "RES {json}" per command on stdout;
// "EVT {json}" lines are pushed before the RES of the command that caused them).
//
//   ORDER <id> <account> <B|S> <price_cents> <qty>
//   CANCEL <id>
//   TRANSFER <from> <to> <amount_cents>
//   SANCTION <account>      UNFREEZE <account>      STATUS <account>
//   STATE [depth]           ALERTS     STATS     RESET
//   GRAPH [min_cents] [window_wires]     (window 0 = all edges)
//   SIGNAL                                price-direction call + the 7 indicator votes
//   SIM [steps] [launder_every] [pace]   run the built-in C++ market simulation (launder_every 0 = no criminals)
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "engine.h"
#include "sim.h"

using hft::Engine;
using hft::Sim;

static void out(Engine* e, const std::string& body) {
  std::string ev = e->takeEvents();
  fputs(ev.c_str(), stdout);
  fputs("RES ", stdout);
  fputs(body.c_str(), stdout);
  fputc('\n', stdout);
  fflush(stdout);
}

static void fail(Engine* e, const char* msg) {
  out(e, std::string("{\"ok\":false,\"error\":\"") + msg + "\"}");
}

static char* nextTok(char* str, const char* delim, char** save) {
  if (str) *save = str;
  if (!save || !*save) return nullptr;
  char* p = *save + strspn(*save, delim);
  if (!*p) { *save = nullptr; return nullptr; }
  char* start = p;
  p = start + strcspn(start, delim);
  if (*p) { *p = '\0'; *save = p + 1; }
  else *save = nullptr;
  return start;
}

int main() {
  Engine* e = new Engine();
  Sim* sim = new Sim(*e);
  char line[4096];
  while (fgets(line, sizeof line, stdin)) {
    char* save = nullptr;
    char* cmd = nextTok(line, " \t\r\n", &save);
    if (!cmd) continue;
    char* a[5] = {nullptr};
    int na = 0;
    while (na < 5 && (a[na] = nextTok(nullptr, " \t\r\n", &save))) na++;
    auto num = [&](int i, long long def = 0) { return i < na ? strtoll(a[i], nullptr, 10) : def; };
    std::string s;
    char buf[256];

    if (!strcmp(cmd, "ORDER")) {
      if (na < 5 || (a[2][0] != 'B' && a[2][0] != 'S')) { fail(e, "usage: ORDER id acct B|S price qty"); continue; }
      hft::OrderResult r;
      e->submitOrder((uint64_t)num(0), (uint32_t)num(1), a[2][0] == 'B', num(3), num(4), r);
      const char* status = !r.ok ? "rejected" : r.rested == 0 ? "filled" : r.trades.size() ? "partial" : "resting";
      snprintf(buf, sizeof buf, "{\"ok\":%s,\"id\":%lld,\"status\":\"%s\",\"reason\":\"%s\",\"rested\":%lld,\"latency_ns\":%lld,\"trades\":[",
               r.ok ? "true" : "false", num(0), status, r.reason, (long long)r.rested, (long long)r.latencyNs);
      s = buf;
      for (size_t i = 0; i < r.trades.size(); i++) {
        const hft::Trade& t = r.trades[i];
        snprintf(buf, sizeof buf, "%s{\"maker_id\":%llu,\"taker_id\":%llu,\"buyer\":%u,\"seller\":%u,\"price\":%lld,\"qty\":%lld}",
                 i ? "," : "", (unsigned long long)t.makerId, (unsigned long long)t.takerId, t.buyer, t.seller,
                 (long long)t.price, (long long)t.qty);
        s += buf;
      }
      s += "]}";
      out(e, s);
    } else if (!strcmp(cmd, "CANCEL")) {
      if (na < 1) { fail(e, "usage: CANCEL id"); continue; }
      out(e, e->cancel((uint64_t)num(0)) ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"unknown_order\"}");
    } else if (!strcmp(cmd, "TRANSFER")) {
      if (na < 3) { fail(e, "usage: TRANSFER from to amount"); continue; }
      const char* why = e->transfer((uint32_t)num(0), (uint32_t)num(1), num(2));
      if (why) { snprintf(buf, sizeof buf, "{\"ok\":false,\"error\":\"%s\"}", why); out(e, buf); }
      else out(e, "{\"ok\":true}");
    } else if (!strcmp(cmd, "SANCTION")) {
      if (na < 1) { fail(e, "usage: SANCTION account"); continue; }
      e->sanction((uint32_t)num(0));
      out(e, "{\"ok\":true}");
    } else if (!strcmp(cmd, "UNFREEZE")) {
      if (na < 1) { fail(e, "usage: UNFREEZE account"); continue; }
      out(e, e->unfreeze((uint32_t)num(0)) ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"not_frozen\"}");
    } else if (!strcmp(cmd, "STATUS")) {
      if (na < 1) { fail(e, "usage: STATUS account"); continue; }
      e->statusJson(s, (uint32_t)num(0));
      out(e, s);
    } else if (!strcmp(cmd, "STATE")) {
      e->stateJson(s, (int)num(0, 10));
      out(e, s);
    } else if (!strcmp(cmd, "ALERTS")) {
      e->alertsJson(s);
      out(e, s);
    } else if (!strcmp(cmd, "GRAPH")) {
      e->graphJson(s, num(0, 100000), (uint64_t)num(1, 0));
      out(e, s);
    } else if (!strcmp(cmd, "STATS")) {
      e->statsJson(s);
      s.pop_back();
      s += ",\"sim\":";
      sim->statsJson(s);
      s += "}";
      out(e, s);
    } else if (!strcmp(cmd, "SIM")) {
      long long steps = num(0, 40), every = num(1, 0), pace = num(2, 25);
      if (steps < 1) steps = 1;
      if (steps > 5000000) steps = 5000000;
      sim->run((int)steps, (int)every, (int)pace, s);
      out(e, s);
    } else if (!strcmp(cmd, "SIGNAL")) {
      sim->signalJson(s);
      out(e, s);
    } else if (!strcmp(cmd, "RESET")) {
      delete sim;
      delete e;
      e = new Engine();
      sim = new Sim(*e);
      out(e, "{\"ok\":true}");
    } else {
      fail(e, "unknown_command");
    }
  }
  delete sim;
  delete e;
  return 0;
}
