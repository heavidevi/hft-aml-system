// Custom data structures for the engine core.
// No std::vector / std::map / std::queue / std::priority_queue / std::unordered_map in here.
#pragma once
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <new>
#include <type_traits>
#include <utility>

namespace ds {

static inline uint64_t mix64(uint64_t x) {  // splitmix64 finalizer
  x += 0x9e3779b97f4a7c15ULL;
  x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
  x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
  return x ^ (x >> 31);
}

// ---------------------------------------------------------------- DynArray
// Growable array. push_back amortized O(1), index O(1).
template <class T>
class DynArray {
  T* d_ = nullptr;
  size_t n_ = 0, cap_ = 0;

 public:
  DynArray() = default;
  DynArray(const DynArray& o) {
    reserve(o.n_);
    for (size_t i = 0; i < o.n_; i++) new (&d_[n_++]) T(o.d_[i]);
  }
  DynArray& operator=(const DynArray&) = delete;
  ~DynArray() {
    for (size_t i = 0; i < n_; i++) d_[i].~T();
    ::operator delete(d_);
  }
  void reserve(size_t c) {
    if (c <= cap_) return;
    T* nd = static_cast<T*>(::operator new(c * sizeof(T)));
    for (size_t i = 0; i < n_; i++) {
      new (&nd[i]) T(std::move(d_[i]));
      d_[i].~T();
    }
    ::operator delete(d_);
    d_ = nd;
    cap_ = c;
  }
  void push_back(const T& v) {
    T tmp(v);  // v may alias an element
    if (n_ == cap_) reserve(cap_ ? cap_ * 2 : 8);
    new (&d_[n_++]) T(std::move(tmp));
  }
  void pop_back() { d_[--n_].~T(); }
  void clear() { while (n_) pop_back(); }
  T& operator[](size_t i) { return d_[i]; }
  const T& operator[](size_t i) const { return d_[i]; }
  T& back() { return d_[n_ - 1]; }
  size_t size() const { return n_; }
  bool empty() const { return n_ == 0; }
};

// -------------------------------------------------------------------- Heap
// Binary heap. `Before(a,b)` is true when a must sit above b.
// push/pop O(log n), top O(1).
template <class T, class Before>
class Heap {
  DynArray<T> a_;
  Before before_;

 public:
  bool empty() const { return a_.empty(); }
  size_t size() const { return a_.size(); }
  const T& top() const { return a_[0]; }
  void push(const T& v) {
    a_.push_back(v);
    size_t i = a_.size() - 1;
    while (i > 0) {
      size_t p = (i - 1) / 2;
      if (!before_(a_[i], a_[p])) break;
      std::swap(a_[i], a_[p]);
      i = p;
    }
  }
  void pop() {
    size_t n = a_.size();
    a_[0] = a_[n - 1];
    a_.pop_back();
    n--;
    size_t i = 0;
    for (;;) {
      size_t l = 2 * i + 1, r = l + 1, b = i;
      if (l < n && before_(a_[l], a_[b])) b = l;
      if (r < n && before_(a_[r], a_[b])) b = r;
      if (b == i) break;
      std::swap(a_[i], a_[b]);
      i = b;
    }
  }
};

// ----------------------------------------------------------------- HashMap
// Open addressing, linear probing, tombstones, load factor <= 0.7.
// uint64 keys. V must be trivially destructible (ints, pointers, small PODs).
// find/put/erase average O(1).
template <class V>
class HashMap {
  static_assert(std::is_trivially_destructible<V>::value, "V must be trivially destructible");
  struct Slot {
    uint64_t key;
    V val;
    uint8_t state;  // 0 empty, 1 full, 2 tombstone
  };
  Slot* s_;
  size_t cap_, size_ = 0, used_ = 0;  // used_ = full + tombstones

  void alloc(size_t c) {
    cap_ = c;
    s_ = new Slot[c];
    for (size_t i = 0; i < c; i++) s_[i].state = 0;
    size_ = used_ = 0;
  }
  void rehash(size_t nc) {
    Slot* old = s_;
    size_t oc = cap_;
    alloc(nc);
    for (size_t i = 0; i < oc; i++)
      if (old[i].state == 1) put(old[i].key, old[i].val);
    delete[] old;
  }

 public:
  explicit HashMap(size_t c = 16) { alloc(c); }
  HashMap(const HashMap&) = delete;
  HashMap& operator=(const HashMap&) = delete;
  ~HashMap() { delete[] s_; }

  size_t size() const { return size_; }
  V* find(uint64_t k) {
    size_t m = cap_ - 1, i = mix64(k) & m;
    while (s_[i].state != 0) {
      if (s_[i].state == 1 && s_[i].key == k) return &s_[i].val;
      i = (i + 1) & m;
    }
    return nullptr;
  }
  void put(uint64_t k, const V& v) {
    if (V* p = find(k)) { *p = v; return; }
    if ((used_ + 1) * 10 > cap_ * 7) rehash((size_ + 1) * 4 > cap_ ? cap_ * 2 : cap_);
    size_t m = cap_ - 1, i = mix64(k) & m;
    long tomb = -1;
    while (s_[i].state != 0) {
      if (s_[i].state == 2 && tomb < 0) tomb = (long)i;
      i = (i + 1) & m;
    }
    if (tomb >= 0) i = (size_t)tomb; else used_++;
    s_[i].key = k; s_[i].val = v; s_[i].state = 1;
    size_++;
  }
  bool erase(uint64_t k) {
    size_t m = cap_ - 1, i = mix64(k) & m;
    while (s_[i].state != 0) {
      if (s_[i].state == 1 && s_[i].key == k) { s_[i].state = 2; size_--; return true; }
      i = (i + 1) & m;
    }
    return false;
  }
  template <class F>
  void forEach(F f) {
    for (size_t i = 0; i < cap_; i++)
      if (s_[i].state == 1) f(s_[i].key, s_[i].val);
  }
};

// ------------------------------------------------------------------- DList
// Doubly linked list. push_back / erase(node) / front are all O(1).
template <class T>
class DList {
 public:
  struct Node { T v; Node* prev; Node* next; };
  Node* head = nullptr;
  Node* tail = nullptr;
  size_t n = 0;

  DList() = default;
  DList(const DList&) = delete;
  DList& operator=(const DList&) = delete;
  ~DList() { while (head) erase(head); }

  Node* push_back(const T& v) {
    Node* x = new Node{v, tail, nullptr};
    if (tail) tail->next = x; else head = x;
    tail = x;
    n++;
    return x;
  }
  void erase(Node* x) {
    if (x->prev) x->prev->next = x->next; else head = x->next;
    if (x->next) x->next->prev = x->prev; else tail = x->prev;
    delete x;
    n--;
  }
};

// --------------------------------------------------------------- SpscRing
// Lock-free single-producer single-consumer ring buffer (N power of two).
// push/pop O(1), wait-free.
template <class T, size_t N>
class SpscRing {
  static_assert((N & (N - 1)) == 0, "N must be a power of two");
  T buf_[N];
  alignas(64) std::atomic<size_t> head_{0};
  alignas(64) std::atomic<size_t> tail_{0};

 public:
  bool push(const T& v) {
    size_t t = tail_.load(std::memory_order_relaxed);
    if (t - head_.load(std::memory_order_acquire) == N) return false;
    buf_[t & (N - 1)] = v;
    tail_.store(t + 1, std::memory_order_release);
    return true;
  }
  bool pop(T& out) {
    size_t h = head_.load(std::memory_order_relaxed);
    if (h == tail_.load(std::memory_order_acquire)) return false;
    out = buf_[h & (N - 1)];
    head_.store(h + 1, std::memory_order_release);
    return true;
  }
};

// ------------------------------------------------------------------ Deque
// Growable circular double-ended queue; all ends O(1) amortized.
// Used both as FIFO and as the monotonic deque (sliding-window max).
template <class T>
class Deque {
  T* d_;
  size_t cap_, head_ = 0, n_ = 0;
  void grow() {
    T* nd = new T[cap_ * 2];
    for (size_t i = 0; i < n_; i++) nd[i] = d_[(head_ + i) % cap_];
    delete[] d_;
    d_ = nd; cap_ *= 2; head_ = 0;
  }

 public:
  Deque() : d_(new T[8]), cap_(8) {}
  Deque(const Deque&) = delete;
  Deque& operator=(const Deque&) = delete;
  ~Deque() { delete[] d_; }
  bool empty() const { return n_ == 0; }
  size_t size() const { return n_; }
  T& front() { return d_[head_]; }
  T& back() { return d_[(head_ + n_ - 1) % cap_]; }
  void push_back(const T& v) { if (n_ == cap_) grow(); d_[(head_ + n_) % cap_] = v; n_++; }
  void pop_front() { head_ = (head_ + 1) % cap_; n_--; }
  void pop_back() { n_--; }
};

// --------------------------------------------------------- CountingBloom
// Counting Bloom filter (8-bit saturating counters, k hashes): add/remove/maybe all O(k).
class CountingBloom {
  uint8_t* c_;
  size_t m_;
  int k_;
  size_t idx(uint64_t key, int i) const {
    uint64_t h1 = mix64(key), h2 = mix64(key ^ 0xa5a5a5a5deadbeefULL) | 1;
    return (size_t)((h1 + (uint64_t)i * h2) % m_);
  }

 public:
  explicit CountingBloom(size_t m = 1 << 16, int k = 3) : c_(new uint8_t[m]()), m_(m), k_(k) {}
  CountingBloom(const CountingBloom&) = delete;
  CountingBloom& operator=(const CountingBloom&) = delete;
  ~CountingBloom() { delete[] c_; }
  void add(uint64_t key) {
    for (int i = 0; i < k_; i++) { uint8_t& c = c_[idx(key, i)]; if (c < 255) c++; }
  }
  void remove(uint64_t key) {  // only call for keys that were added
    for (int i = 0; i < k_; i++) { uint8_t& c = c_[idx(key, i)]; if (c > 0 && c < 255) c--; }
  }
  bool maybe(uint64_t key) const {
    for (int i = 0; i < k_; i++) if (c_[idx(key, i)] == 0) return false;
    return true;
  }
  size_t nonZero() const { size_t n = 0; for (size_t i = 0; i < m_; i++) n += c_[i] != 0; return n; }
  size_t slots() const { return m_; }
};

// ------------------------------------------------------------------ DynCsr
// Dynamic CSR adjacency: a compact CSR block plus a small pending edge buffer.
// New edges land in `pending` (O(1)); once it reaches `rebuildAt` the whole
// structure is rebuilt with a counting sort in O(V + E).
// Neighbour scan = CSR row + scan of pending.
class DynCsr {
  DynArray<uint32_t> rowptr_, col_;
  struct E { uint32_t u, v; };
  DynArray<E> pending_;
  uint32_t nbuilt_ = 0, nnodes_ = 0;
  size_t rebuildAt_, rebuilds_ = 0;

 public:
  explicit DynCsr(size_t rebuildAt = 32) : rebuildAt_(rebuildAt) {}
  void ensureNodes(uint32_t n) { if (n > nnodes_) nnodes_ = n; }
  size_t pendingSize() const { return pending_.size(); }
  size_t edgeCount() const { return col_.size() + pending_.size(); }
  size_t rebuilds() const { return rebuilds_; }
  void addEdge(uint32_t u, uint32_t v) {
    pending_.push_back(E{u, v});
    if (pending_.size() >= rebuildAt_) rebuild();
  }
  void rebuild() {
    uint32_t n = nnodes_;
    size_t total = col_.size() + pending_.size();
    DynArray<uint32_t> nrow, ncol, cur;
    nrow.reserve(n + 1); cur.reserve(n + 1); ncol.reserve(total);
    for (uint32_t i = 0; i <= n; i++) { nrow.push_back(0); cur.push_back(0); }
    for (uint32_t u = 0; u < nbuilt_; u++) nrow[u + 1] += rowptr_[u + 1] - rowptr_[u];
    for (size_t i = 0; i < pending_.size(); i++) nrow[pending_[i].u + 1]++;
    for (uint32_t i = 0; i < n; i++) nrow[i + 1] += nrow[i];
    for (size_t i = 0; i < total; i++) ncol.push_back(0);
    for (uint32_t i = 0; i < n; i++) cur[i] = nrow[i];
    for (uint32_t u = 0; u < nbuilt_; u++)
      for (uint32_t j = rowptr_[u]; j < rowptr_[u + 1]; j++) ncol[cur[u]++] = col_[j];
    for (size_t i = 0; i < pending_.size(); i++) ncol[cur[pending_[i].u]++] = pending_[i].v;
    rowptr_.clear(); col_.clear(); pending_.clear();
    for (size_t i = 0; i < nrow.size(); i++) rowptr_.push_back(nrow[i]);
    for (size_t i = 0; i < ncol.size(); i++) col_.push_back(ncol[i]);
    nbuilt_ = n;
    rebuilds_++;
  }
  template <class F>
  void forEachOut(uint32_t u, F f) const {
    if (u < nbuilt_) for (uint32_t j = rowptr_[u]; j < rowptr_[u + 1]; j++) f(col_[j]);
    for (size_t i = 0; i < pending_.size(); i++) if (pending_[i].u == u) f(pending_[i].v);
  }
};

}  // namespace ds
