# Wide arithmetic experiment

Full-width 64-bit Montgomery limbs using Wasm `i64.mul_wide_u`, `i64.add128`, and `i64.sub128`. Provides add, subtract, multiply, square, canonical reduction, complete fast inversion, a Kaliski reference, batch inversion, exponentiation, negation, raw integer helpers, packed-byte I/O, memory helpers, and Montgomery conversions. Curve/MSM integration remains future work.

```sh
# One-time setup: isolate the compatible wasmati snapshot.
git -C ../wasmati worktree add --detach ../wasmati-wide-baseline 4ede9ad
npm ci --prefix ../wasmati-wide-baseline
npm run build --prefix ../wasmati-wide-baseline
npm install --no-save --package-lock=false ../wasmati-wide-baseline
npm run test-wide
npm run benchmark-wide
# Optionally select individual fields:
npm run benchmark-wide -- bn254-scalar
```

The scripts require a Node build supporting `--wasm-wide-arithmetic`; measurements below use Node `v27.0.0-nightly20261006fcfb7ecc0b`. The local dependency is pinned to wasmati commit `4ede9ad`; the sibling checkout now has further API changes under development.

`Field.create(p)` in `field.ts` builds a modulus-specific module. `Wasm` contains the pointer operations; `Memory.local.getPointers()` allocates field elements. `fromBigint()` and `toBigint()` convert between ordinary bigints and Montgomery representation. `writeBigint()` and `readBigint()` access the raw limb representation. Single-element arithmetic allows its output to alias an input. Raw equality and zero checks compare stored representations; use `reduce()` first for modular equality.

For `n = ceil(bitLength(p) / 64)` and `R = 2^(64n)`, inputs and outputs are in `[0, 2p)` when `2p < R`, otherwise `[0, p)`. The builder omits multiplication's final reduction when `4p <= R`, omits the extra carry limb when `p + inputLimit <= R`, and specializes zero/one limbs of the modulus. These choices happen during module generation, including for fields larger than 255 bits. Squaring currently specializes the multiplication kernel to load its operand once; it does not yet exploit symmetric cross-products.

50 tests cover all 17 example fields, six moduli bordering the reduction/carry thresholds, and inversion of a composite modulus. Property tests use the existing `Random`, `wasmSpec`, and `createEquivalentWasm` framework with bigint references. They check arithmetic and lazy bounds, aliasing, inversion, batch inversion, exponentiation, negation, raw integer operations, shifts, and little-endian packed bytes. Explicit cases check carry boundaries, whole-limb inversion shifts, zero/nonunit traps, conversions, and repeated squaring.

Benchmarks use dependent chains inside Wasm and the existing single timed run, without extra warmup or sampling. Each wide and production benchmark starts with explicit input writes so preceding benchmarks cannot affect its inputs. The same initial raw field value is used for production and wide arithmetic. The Pallas and BN254 scalar comparisons also include paired and single 51x5; paired timings are per field operation. These are arithmetic microbenchmarks, not MSM measurements.

Measured on 2026-10-06 on an AMD Ryzen 7 3700X, pinned to CPU 2 (`taskset -c 2 npm run benchmark-wide`). Results below are nanoseconds per operation, shown as existing 29-bit Montgomery arithmetic → wide arithmetic:

| Field | Multiply | Square | Add | Subtract |
| --- | ---: | ---: | ---: | ---: |
| Pallas | 38 → 19 | 28 → 18 | 13 → 9 | 8 → 5 |
| BLS12-377 | 101 → 41 | 79 → 39 | 17 → 11 | 11 → 7 |
| BN254 scalar | 51 → 20 | 42 → 19 | 13 → 9 | 7 → 5 |

Multiplication improves by about 2.0×, 2.5×, and 2.6× respectively. Pallas 51x5 multiply measured 47 ns per element (paired), 46 ns (single), and 45 ns (paired without FMA), versus 19 ns for wide. BN254 scalar uses the curve order; its four 64-bit limbs satisfy `4p <= R`, so multiplication omits the final reduction. Its 51x5 multiply measured 50/58/57 ns respectively, versus 20 ns for wide. No end-to-end MSM speedup has been measured yet.

The initial addition slowdown report was a benchmark artifact: production addition inherited the buffer left by the schoolbook/square benchmarks, which could become zero; wide addition started with a fresh random value. A BN254 scalar control measured production addition at 6.5 ns on zero versus 12.2 ns on nonzero input, and the original wide kernel at 4.3 versus 8.9 ns. Fresh inputs remove that unfair comparison. The updated wide kernel also eliminates redundant reduction branches, combines constant-limb subtraction with its borrow when safe, and omits top-limb carry extraction when the modulus guarantees the sum fits. Wide addition is now roughly 1.4–1.5× faster in these measurements. The schoolbook row in the runner measures a raw integer product; it is not used as a modular field multiplication comparison.

The `inverseKaliski` reference follows the mainline algorithm, retaining batched trailing-zero shifts and adapting them to full 64-bit limbs. It reduces a scratch copy of the input, preserves the input unless it aliases the output, and traps on zero or a nonunit. A modulus-specific correction table replaces the mainline shift-plus-multiply correction with one Montgomery multiplication. `inverse(scratch, out, x)` requires three contiguous field elements of scratch; `batchInverse(scratch, out, xs, count)` requires four. Scratch must be disjoint from inputs and output. Batch input and output must be disjoint for batches larger than one; zero-length batches return immediately.

`exp(scratch, out, x, exponent)` needs one disjoint scratch element. The exponent is an ordinary raw integer in the full limb layout. `leftShift(out, x, k)` follows the mainline REDC contract, computing `x * 2^k * R^-1 mod p` for `0 <= k < bitLength(p)`. Packed-byte helpers operate on the raw representation without Montgomery conversion or reduction. `addNoReduce` and `subtractNoReduce` are raw integer operations modulo R; their outputs must satisfy the arithmetic input bound before being passed to multiplication. Existing loose-range curve formulas cannot consume these helpers without checking their intermediate bounds.

Before porting the fast algorithm, inversion comparisons used the mainline dependent chain: one addition followed by one Kaliski inverse, 500,000 iterations, one timed run without added warmup. On the same machine and runtime, the measured times are:

| Field | Mainline add + inverse | Wide add + inverse | Speedup |
| --- | ---: | ---: | ---: |
| Pallas | 5.11 µs | 3.05 µs | 1.67× |
| BLS12-377 | 10.22 µs | 6.05 µs | 1.69× |
| BN254 scalar | 5.14 µs | 3.08 µs | 1.67× |

The mainline runner now allocates three scratch elements for Kaliski instead of two. The former allocation overlapped its third scratch element with the input buffer; these inversion numbers use the corrected allocation.

The default `inverse` now ports the batched algorithm in `src/inverse/faster-inverse-wasm.ts`. Each batch accumulates 62 binary steps in a SIMD 2×2 matrix using the high/low approximations, then applies that matrix to full-width limbs with signed wide products. Matrix entries fit signed 64-bit values. Negative full remainders are corrected together with the corresponding matrix row; the original experimental implementation leaves sign correction as a TODO.

Inversion coefficients are divided by `2^62` modulo p after each batch. Adding a multiple of p chosen from the low 62 bits makes this division exact; one conditional addition/subtraction then restores canonical coefficients. This keeps coefficients bounded for fields close to R as well as fields with unused high bits. The final coefficient is a complete inverse of the raw input. A single Montgomery multiplication by `R^3 mod p` converts it to the Montgomery inverse. Zero/nonunit behavior, aliasing, and the three/four-element scratch requirements are unchanged. `batchInverse` uses the fast path automatically.

The same property-test framework now checks inversion at all six carry thresholds, including odd composite moduli; nearly equal remainders; explicit sign-correction regressions; and 10,000 additional uniform cases over Pallas, Goldilocks, secp256k1, BN254 scalar, and BLS12-377.

A new run compares the complete fast wide inverse, the previous wide Kaliski inverse, mainline Kaliski, and the existing 29-bit fast almost-inverse core. Each row still measures the addition-plus-inversion chain with one timed run of 500,000 iterations. The last column omits the Montgomery correction and is labelled separately in the runner.

| Field | Complete fast wide | Wide Kaliski | Mainline Kaliski | Existing fast core only |
| --- | ---: | ---: | ---: | ---: |
| Pallas | 2.65 µs | 4.48 µs | 8.12 µs | 3.23 µs |
| BLS12-377 | 4.25 µs | 8.59 µs | 17.04 µs | 5.33 µs |
| BN254 scalar | 2.66 µs | 4.48 µs | 8.14 µs | 3.21 µs |

This run was slower overall than the earlier run: Pallas wide multiplication measured 30 ns rather than 19 ns. Compare the inversion implementations within this run; the complete fast wide path is about 1.7–2.0× faster than wide Kaliski and 3.1–4.0× faster than mainline Kaliski. The server had other CPU-intensive tasks running. These timings do not establish an MSM speedup.
