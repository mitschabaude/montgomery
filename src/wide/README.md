# Wide arithmetic experiment

Full-width 64-bit Montgomery limbs using Wasm `i64.mul_wide_u`, `i64.add128`, and `i64.sub128`. This first iteration provides add, subtract, multiply, square, canonical reduction, memory helpers, and Montgomery conversions. Inversion and curve/MSM integration are still future work.

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
# Explicitly opt into median-of-three sampling:
npm run benchmark-wide -- --samples=3
```

The scripts require a Node build supporting `--wasm-wide-arithmetic`; measurements below use Node `v27.0.0-nightly20261006fcfb7ecc0b`. The local dependency is pinned to wasmati commit `4ede9ad`; the sibling checkout now has further API changes under development.

`Field.create(p)` in `field.ts` builds a modulus-specific module. `Wasm` contains the pointer operations; `Memory.local.getPointers()` allocates field elements. `fromBigint()` and `toBigint()` convert between ordinary bigints and Montgomery representation. `writeBigint()` and `readBigint()` access the raw limb representation. Every arithmetic operation allows its output to alias an input. Raw equality and zero checks compare stored representations; use `reduce()` first for modular equality.

For `n = ceil(bitLength(p) / 64)` and `R = 2^(64n)`, inputs and outputs are in `[0, 2p)` when `2p < R`, otherwise `[0, p)`. The builder omits multiplication's final reduction when `4p <= R`, omits the extra carry limb when `p + inputLimit <= R`, and specializes zero/one limbs of the modulus. These choices happen during module generation, including for fields larger than 255 bits. Squaring currently specializes the multiplication kernel to load its operand once; it does not yet exploit symmetric cross-products.

23 tests cover all 17 example fields and six moduli bordering the reduction/carry thresholds, including small primes, 64-bit Goldilocks, Pasta, BN254, secp256k1, and BLS12-377/381. Boundary and deterministic randomized tests check lazy input/output bounds, overflowing carries, input/output aliasing, conversions, and repeated squaring against bigint arithmetic.

Benchmarks use dependent chains inside Wasm, 10,000 warmup iterations, and one timed sample by default. `--samples=3` explicitly selects three samples and reports their median. Output prints the sample count, iterations per sample, and operations per iteration (including three additions/subtractions or two field multiplications for paired 51x5). All inputs reset before warmup and each timed sample, with the same initial raw field value used for production and wide arithmetic. The Pallas and BN254 scalar comparisons also include paired and single 51x5; paired timings are per field operation. These are arithmetic microbenchmarks, not MSM measurements.

Measured on 2026-10-06 on an AMD Ryzen 7 3700X, pinned to CPU 2 (`taskset -c 2 npm run benchmark-wide -- --samples=3`). Results below are nanoseconds per operation, shown as existing 29-bit Montgomery arithmetic → wide arithmetic:

| Field | Multiply | Square | Add | Subtract |
| --- | ---: | ---: | ---: | ---: |
| Pallas | 36.2 → 18.9 | 28.2 → 18.4 | 12.0 → 8.5 | 7.6 → 4.7 |
| BLS12-377 | 99.0 → 40.2 | 77.5 → 39.3 | 15.7 → 9.9 | 11.9 → 6.1 |
| BN254 scalar | 51.9 → 19.8 | 41.7 → 19.2 | 12.1 → 8.1 | 7.2 → 4.3 |

Multiplication improves by about 1.9×, 2.5×, and 2.6× respectively. Pallas 51x5 multiply measured 47.0 ns per element (paired), 45.2 ns (single), and 44.8 ns (paired without FMA), versus 18.9 ns for wide. BN254 scalar uses the curve order; its four 64-bit limbs satisfy `4p <= R`, so multiplication omits the final reduction. Its 51x5 multiply measured 49.3/55.9/56.1 ns respectively, versus 19.8 ns for wide. No end-to-end MSM speedup has been measured yet.

The initial addition slowdown report was a benchmark artifact: production addition inherited the buffer left by the schoolbook/square benchmarks, which could become zero; wide addition started with a fresh random value. A BN254 scalar control measured production addition at 6.5 ns on zero versus 12.2 ns on nonzero input, and the original wide kernel at 4.3 versus 8.9 ns. Fresh inputs remove that unfair comparison. The updated wide kernel also eliminates redundant reduction branches, combines constant-limb subtraction with its borrow when safe, and omits top-limb carry extraction when the modulus guarantees the sum fits. Wide addition is now roughly 1.4–1.6× faster in these measurements. The schoolbook row in the runner measures a raw integer product; it is not used as a modular field multiplication comparison.
