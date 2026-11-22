// Price-direction signal from 7 classic indicators, computed in C++ on "bars"
// (one bar = 20 simulation steps). Header-only, O(1)/O(20) per bar, no allocation.
//   votes: EMA 5/13 trend, MACD histogram, RSI(14) extremes, Bollinger %B,
//          momentum ROC(10), order-book imbalance (top 5 levels), aggressor-flow imbalance
// score = sum(weight * vote) in [-100, 100]; UP if >= 20, DOWN if <= -20, else FLAT.
// Every UP/DOWN call is checked HORIZON bars later, so the hit rate is measured, not claimed.
#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>

namespace hft {

class Signals {
 public:
  static constexpr int WARMUP = 30, HORIZON = 5;

  void addBar(double close, double buyVol, double sellVol, double bidDepth, double askDepth) {
    uint64_t i = n_;
    c_[i % N] = close;
    n_++;
    auto ema = [&](double& e, int p) { e = i == 0 ? close : e + (2.0 / (p + 1)) * (close - e); };
    ema(ema5_, 5); ema(ema13_, 13); ema(ema12_, 12); ema(ema26_, 26);
    macd_ = ema12_ - ema26_;
    macdSig_ = i == 0 ? macd_ : macdSig_ + 0.2 * (macd_ - macdSig_);
    hist_ = macd_ - macdSig_;

    if (i > 0) {  // RSI(14), Wilder smoothing
      double d = close - c_[(i - 1) % N], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      if (i <= 14) { gainAcc_ += g; lossAcc_ += l; if (i == 14) { avgGain_ = gainAcc_ / 14; avgLoss_ = lossAcc_ / 14; } }
      else { avgGain_ = (avgGain_ * 13 + g) / 14; avgLoss_ = (avgLoss_ * 13 + l) / 14; }
      if (i >= 14) rsi_ = (avgGain_ + avgLoss_ == 0) ? 50 : avgLoss_ == 0 ? 100 : 100 - 100 / (1 + avgGain_ / avgLoss_);
    }
    uint64_t len = n_ < 20 ? n_ : 20;  // Bollinger(20, 2 sigma)
    double mean = 0, var = 0;
    for (uint64_t k = 0; k < len; k++) mean += c_[(n_ - 1 - k) % N];
    mean /= (double)len;
    for (uint64_t k = 0; k < len; k++) { double x = c_[(n_ - 1 - k) % N] - mean; var += x * x; }
    double sd = std::sqrt(var / (double)len);
    bbUp_ = mean + 2 * sd; bbLo_ = mean - 2 * sd;
    pctB_ = bbUp_ > bbLo_ ? (close - bbLo_) / (bbUp_ - bbLo_) : 0.5;
    roc_ = n_ > 10 ? (close - c_[(n_ - 1 - 10) % N]) / c_[(n_ - 1 - 10) % N] * 100.0 : 0;
    imb_ = bidDepth + askDepth > 0 ? (bidDepth - askDepth) / (bidDepth + askDepth) : 0;
    double tot = buyVol + sellVol, f = tot > 0 ? (buyVol - sellVol) / tot : 0;
    flow_ = i == 0 ? f : flow_ + 0.3 * (f - flow_);

    if (i >= (uint64_t)HORIZON) {  // grade the call made HORIZON bars ago
      size_t s = (size_t)((i - HORIZON) % 8);
      if (pdir_[s] != 0 && pbar_[s] == i - HORIZON) {
        double move = close - pprice_[s];
        if (move != 0) { total_++; if ((move > 0) == (pdir_[s] > 0)) hits_++; }
      }
      pdir_[s] = 0;
    }
    if (n_ < (uint64_t)WARMUP) return;
    const char* nm[7] = {"EMA 5/13 trend", "MACD histogram", "RSI(14) extremes", "Bollinger %B", "Momentum ROC(10)", "Book imbalance (top 5)", "Aggressor flow"};
    int w[7] = {20, 20, 15, 15, 10, 10, 10};
    double val[7] = {ema5_ - ema13_, hist_, rsi_, pctB_, roc_, imb_, flow_};
    int v[7] = {ema5_ > ema13_ ? 1 : ema5_ < ema13_ ? -1 : 0, hist_ > 0 ? 1 : hist_ < 0 ? -1 : 0,
                rsi_ < 30 ? 1 : rsi_ > 70 ? -1 : 0, pctB_ < 0.1 ? 1 : pctB_ > 0.9 ? -1 : 0,
                roc_ > 0 ? 1 : roc_ < 0 ? -1 : 0, imb_ > 0.15 ? 1 : imb_ < -0.15 ? -1 : 0, flow_ > 0.1 ? 1 : flow_ < -0.1 ? -1 : 0};
    score_ = 0;
    for (int k = 0; k < 7; k++) { votes_[k] = Vote{nm[k], v[k], w[k], val[k]}; score_ += v[k] * w[k]; }
    dir_ = score_ >= 20 ? 1 : score_ <= -20 ? -1 : 0;
    price_ = close;
    if (dir_ != 0) { size_t s = (size_t)(i % 8); pbar_[s] = i; pprice_[s] = close; pdir_[s] = dir_; }
  }

  void json(std::string& o) const {
    char b[256];
    if (n_ < (uint64_t)WARMUP) { snprintf(b, sizeof b, "{\"ready\":false,\"bars\":%lld,\"warmup\":%d}", (long long)n_, WARMUP); o += b; return; }
    snprintf(b, sizeof b, "{\"ready\":true,\"bars\":%lld,\"direction\":\"%s\",\"score\":%d,\"price\":%.0f,", (long long)n_,
             dir_ > 0 ? "UP" : dir_ < 0 ? "DOWN" : "FLAT", score_, price_);
    o += b;
    snprintf(b, sizeof b, "\"indicators\":{\"ema_fast\":%.2f,\"ema_slow\":%.2f,\"macd\":%.3f,\"macd_signal\":%.3f,\"rsi\":%.1f,\"boll_upper\":%.2f,\"boll_lower\":%.2f,\"boll_pct_b\":%.2f},\"votes\":[",
             ema5_, ema13_, macd_, macdSig_, rsi_, bbUp_, bbLo_, pctB_);
    o += b;
    for (int k = 0; k < 7; k++) {
      snprintf(b, sizeof b, "%s{\"name\":\"%s\",\"vote\":%d,\"weight\":%d,\"value\":%.3f}", k ? "," : "", votes_[k].name, votes_[k].vote, votes_[k].weight, votes_[k].value);
      o += b;
    }
    snprintf(b, sizeof b, "],\"accuracy\":{\"hits\":%lld,\"total\":%lld,\"horizon_bars\":%d}}", (long long)hits_, (long long)total_, HORIZON);
    o += b;
  }

 private:
  static constexpr size_t N = 64;
  struct Vote { const char* name; int vote, weight; double value; };
  double c_[N] = {0};
  uint64_t n_ = 0, hits_ = 0, total_ = 0, pbar_[8] = {0};
  double ema5_ = 0, ema13_ = 0, ema12_ = 0, ema26_ = 0, macd_ = 0, macdSig_ = 0, hist_ = 0;
  double avgGain_ = 0, avgLoss_ = 0, gainAcc_ = 0, lossAcc_ = 0, rsi_ = 50;
  double bbUp_ = 0, bbLo_ = 0, pctB_ = 0.5, roc_ = 0, imb_ = 0, flow_ = 0, price_ = 0, pprice_[8] = {0};
  int score_ = 0, dir_ = 0, pdir_[8] = {0};
  Vote votes_[7] = {};
};

}  // namespace hft