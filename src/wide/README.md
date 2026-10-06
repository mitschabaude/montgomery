# Wide arithmetic experiment

Full-width 64-bit Montgomery limbs using Wasm `i64.mul_wide_u`, `i64.add128`, and `i64.sub128`. This first iteration provides add, subtract, multiply, square, canonical reduction, memory helpers, and Montgomery conversions. Inversion and curve/MSM integration are still future work.

```sh
# Until the updated wasmati is published, use the built sibling checkout.
npm install --no-save --package-lock=false ../wasmati
npm run test-wide
npm run benchmark-wide
# Optionally select individual fields:
npm run benchmark-wide -- bn254-scalar
```

The scripts require a Node build supporting `--wasm-wide-arithmetic`; measurements below use Node `v27.0.0-nightly20261006fcfb7ecc0b`. The sibling wasmati checkout must have been built with `npm run build`.

`Field.create(p)` in `field.ts` builds a modulus-specific module. `Wasm` contains the pointer operations; `Memory.local.getPointers()` allocates field elements. `fromBigint()` and `toBigint()` convert between ordinary bigints and Montgomery representation. `writeBigint()` and `readBigint()` access the raw limb representation. Every arithmetic operation allows its output to alias an input. Raw equality and zero checks compare stored representations; use `reduce()` first for modular equality.

For `n = ceil(bitLength(p) / 64)` and `R = 2^(64n)`, inputs and outputs are in `[0, 2p)` when `2p < R`, otherwise `[0, p)`. The builder omits multiplication's final reduction when `4p <= R`, omits the extra carry limb when `p + inputLimit <= R`, and specializes zero/one limbs of the modulus. These choices happen during module generation, including for fields larger than 255 bits. Squaring currently specializes the multiplication kernel to load its operand once; it does not yet exploit symmetric cross-products.

23 tests cover all 17 example fields and six moduli bordering the reduction/carry thresholds, including small primes, 64-bit Goldilocks, Pasta, BN254, secp256k1, and BLS12-377/381. Boundary and deterministic randomized tests check lazy input/output bounds, overflowing carries, input/output aliasing, conversions, and repeated squaring against bigint arithmetic.

Benchmarks use dependent chains inside Wasm, a warmup, and the median of three samples of approximately ten million operations. The Pallas comparison also includes the paired and single 51x5 experiments; paired timings are per field operation. These are arithmetic microbenchmarks, not MSM measurements.

Measured on 2026-10-06 on an AMD Ryzen 7 3700X, pinned to CPU 2 (`taskset -c 2 npm run benchmark-wide`). Results below are nanoseconds per operation, shown as existing 29-bit Montgomery arithmetic → wide arithmetic, from isolated runs:

| Field | Multiply | Square | Add | Subtract |
| --- | ---: | ---: | ---: | ---: |
| Pallas | 37 → 19 | 28 → 18 | 6 → 9 | 8 → 5 |
| BLS12-377 | 101 → 40 | 78 → 39 | 9 → 10 | 11 → 6 |
| BN254 scalar | 50 → 20 | 42 → 19 | 6 → 9 | 8 → 4 |

Multiplication improves by about 1.9×, 2.5×, and 2.5× respectively. Pallas 51x5 multiply measured 47 ns per element (paired), 45 ns (single), and 45 ns (paired without FMA), versus 19 ns for wide. Wide beats the schoolbook multiplication benchmark too (27/58/27 ns respectively). Addition is currently slower than production; subtraction is faster. Timings vary across runs, especially branch-heavy add/subtract and the production Pallas multiplication (37–48 ns in the two isolated runs). No end-to-end MSM speedup has been measured yet.

BN254 scalar uses the curve order, not its base-field modulus. Its four 64-bit limbs satisfy `4p <= R`, so multiplication omits the final reduction. Its 51x5 multiply measured 49 ns per element (paired), 57 ns (single), and 57 ns (paired without FMA).
