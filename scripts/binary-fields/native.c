// Native baselines for ./bench.ts: GF(2^128) mod x^128 + x^7 + x^2 + x + 1.
//
// gcc -O3 -march=native scripts/binary-fields/native.c -o build/binary-fields/native
// build/binary-fields/native            timings
// build/binary-fields/native check      reads "a b" hex pairs from stdin, prints a*b per kernel
#if defined(__x86_64__)
#include <immintrin.h>
#elif defined(__aarch64__)
#include <arm_neon.h>
#endif
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <time.h>

typedef struct { uint64_t lo, hi; } u128;
typedef unsigned __int128 wide;

static inline u128 reduce(uint64_t z0, uint64_t z1, uint64_t z2, uint64_t z3) {
  uint64_t h0 = z2 ^ (z3 >> 63) ^ (z3 >> 62) ^ (z3 >> 57);
  u128 r;
  r.lo = z0 ^ h0 ^ (h0 << 1) ^ (h0 << 2) ^ (h0 << 7);
  r.hi = z1 ^ z3 ^ ((z3 << 1) | (h0 >> 63)) ^ ((z3 << 2) | (h0 >> 62)) ^ ((z3 << 7) | (h0 >> 57));
  return r;
}

static inline u128 karatsuba(u128 p0, u128 p2, u128 p1) {
  uint64_t mid0 = p1.lo ^ p0.lo ^ p2.lo, mid1 = p1.hi ^ p0.hi ^ p2.hi;
  return reduce(p0.lo, p0.hi ^ mid0, p2.lo ^ mid1, p2.hi);
}

// the hardware carry-less multiply: pclmulqdq on x86_64, pmull on arm64
static inline u128 clmul_hw(uint64_t x, uint64_t y) {
#if defined(__x86_64__)
  __m128i p = _mm_clmulepi64_si128(_mm_cvtsi64_si128(x), _mm_cvtsi64_si128(y), 0);
  return (u128){(uint64_t)_mm_cvtsi128_si64(p), (uint64_t)_mm_extract_epi64(p, 1)};
#elif defined(__aarch64__)
  uint64x2_t p = vreinterpretq_u64_p128(vmull_p64(x, y));
  return (u128){vgetq_lane_u64(p, 0), vgetq_lane_u64(p, 1)};
#endif
}

static uint64_t every5[5];

static inline u128 clmul_wide(uint64_t x, uint64_t y) {
  uint64_t xs[5], ys[5], lo = 0, hi = 0;
  for (int c = 0; c < 5; c++) xs[c] = x & every5[c], ys[c] = y & every5[c];
  for (int c = 0; c < 5; c++) {
    wide acc = 0;
    for (int a = 0; a < 5; a++) acc ^= (wide)xs[a] * ys[(c - a + 5) % 5];
    lo |= (uint64_t)acc & every5[c];
    hi |= (uint64_t)(acc >> 64) & every5[(c + 1) % 5];
  }
  return (u128){lo, hi};
}

#define KARATSUBA(clmul)                                                     \
  static inline u128 mul_##clmul(u128 a, u128 b) {                           \
    return karatsuba(clmul_##clmul(a.lo, b.lo), clmul_##clmul(a.hi, b.hi),   \
                     clmul_##clmul(a.lo ^ a.hi, b.lo ^ b.hi));               \
  }
KARATSUBA(hw)
KARATSUBA(wide)

static double now() {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e9 + t.tv_nsec;
}

#define N 1024
#define L 2000000
#define R 2000
static u128 xs[N], ys[N], zs[N];

#define BENCH(name)                                                          \
  {                                                                          \
    double latency = 1e30, throughput = 1e30;                                \
    for (int k = 0; k < 5; k++) {                                            \
      u128 x = xs[0];                                                        \
      double t = now();                                                      \
      for (int i = 0; i < L; i++) x = mul_##name(x, ys[0]);                  \
      t = now() - t;                                                         \
      xs[1].lo ^= x.lo;                                                      \
      if (t < latency) latency = t;                                          \
      t = now();                                                             \
      for (int r = 0; r < R; r++)                                            \
        for (int i = 0; i < N; i++) zs[i] = mul_##name(xs[i], ys[i]);        \
      t = now() - t;                                                         \
      xs[2].lo ^= zs[N - 1].lo;                                              \
      if (t < throughput) throughput = t;                                    \
    }                                                                        \
    printf("%-8s latency %6.1f ns   throughput %6.1f ns\n", #name,          \
           latency / L, throughput / ((double)R * N));                       \
  }

int main(int argc, char **argv) {
  for (int c = 0; c < 5; c++)
    for (int i = c; i < 64; i += 5) every5[c] |= 1ull << i;
  if (argc > 1 && strcmp(argv[1], "check") == 0) {
    u128 a, b;
    while (scanf("%lx %lx %lx %lx", &a.hi, &a.lo, &b.hi, &b.lo) == 4) {
      u128 p = mul_hw(a, b), w = mul_wide(a, b);
      printf("%016lx%016lx %016lx%016lx\n", p.hi, p.lo, w.hi, w.lo);
    }
    return 0;
  }
  uint64_t s = 0x9e3779b97f4a7c15;
  for (int i = 0; i < N; i++) {
    s ^= s << 13, s ^= s >> 7, s ^= s << 17, xs[i].lo = s;
    s ^= s << 13, s ^= s >> 7, s ^= s << 17, xs[i].hi = s;
    s ^= s << 13, s ^= s >> 7, s ^= s << 17, ys[i].lo = s;
    s ^= s << 13, s ^= s >> 7, s ^= s << 17, ys[i].hi = s;
  }
  BENCH(hw)
  BENCH(wide)
  return 0;
}
