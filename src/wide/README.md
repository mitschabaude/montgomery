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

68 tests cover all 17 example fields, six moduli bordering the reduction/carry thresholds, and inversion of a composite modulus. Property tests use the existing `Random`, `wasmSpec`, and `createEquivalentWasm` framework with bigint references. They check arithmetic and lazy bounds, aliasing, inversion, batch inversion, exponentiation, negation, raw integer operations, shifts, and little-endian packed bytes. Explicit cases check carry boundaries, whole-limb inversion shifts, zero/nonunit traps, conversions, and repeated squaring.

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

The default `inverse` ports the batched algorithm in `src/inverse/faster-inverse-wasm.ts`. Each batch accumulates 62 binary steps in a SIMD 2×2 matrix using high/low approximations, then applies the matrix to full-width limbs with signed wide products. Matrix entries fit signed 64-bit values. Negative full remainders are corrected together with the corresponding matrix row.

Inversion coefficients are divided by `2^62` modulo p after each batch. Adding a multiple of p chosen from the low 62 bits makes this division exact; one conditional addition/subtraction restores canonical coefficients. This keeps coefficients bounded for fields close to R as well as fields with unused high bits. A final Montgomery multiplication by `R^3 mod p` converts the raw inverse into the Montgomery inverse. `batchInverse` uses the fast path automatically.

Main's experimental `fastInverse` previously exported only an almost-inverse core, with a sign-handling TODO. Its legacy benchmark discards the returned correction exponent. The core also gives incorrect results on some boundary inputs, including Pallas `p - 1`. It now has an experimental complete `inverse(scratch, out, input)` entry point that applies the Montgomery correction, verifies the inverse, and falls back to the existing Kaliski implementation if verification fails. It uses three scratch elements and supports output/input aliasing. `fallbackCount` records correctness fallbacks for tests and benchmark reporting. The production field factory currently uses Kaliski.

Inversion comparisons now use `scripts/field-benchmarks/wide-inverse.ts`, called by `benchmark-wide`. Both layouts receive the same array of 256 nonzero raw integers. Every complete implementation is checked against bigint on every fixture before timing, and the runner reports that validation explicitly. Each timed row performs 500,000 inversions by cycling over that immutable array in Wasm. Outputs never become subsequent inputs. There is no addition, benchmark-loop warmup, repeated timing, or median. The existing timing helper APIs are unchanged. The main almost-inverse core is reported separately, with correction/verification omitted. The runner also checks that the fixture array remains unchanged after each timed complete-inverse loop, outside the timed region.

Measured together in one run on the same AMD Ryzen 7 3700X and Node build, pinned to CPU 2:

| Field | Complete main fast | Complete wide fast | Main Kaliski | Wide Kaliski | Main core only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pallas | 2.523 µs | 1.980 µs | 5.470 µs | 3.168 µs | 2.384 µs |
| BLS12-377 | 4.201 µs | 3.173 µs | 10.857 µs | 6.182 µs | 3.947 µs |
| BN254 scalar | 2.550 µs | 2.022 µs | 5.485 µs | 3.185 µs | 2.405 µs |

Main used zero correctness fallbacks on all 256 fixtures and all 500,000 timed calls for each field. Complete wide inversion was approximately 1.27×, 1.32×, and 1.26× faster than the completed main fast implementation in this run. These fixed-input timings replace the earlier comparisons of evolving add-plus-inverse chains. Other CPU-intensive jobs were active on the server; absolute timings remain sensitive to system load. No MSM speedup has been measured.

Property tests use the existing framework to check both complete fast implementations across all 17 example fields, lazy inputs, aliases, nearly equal remainders, and the main fallback boundary case. Tests also cover a composite modulus, inversion at six wide carry thresholds, explicit wide sign-correction regressions, and 10,000 additional uniform wide cases.
