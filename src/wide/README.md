# Wide arithmetic experiment

Field arithmetic with full-width 64-bit Montgomery limbs, using the Wasm wide arithmetic instructions `i64.mul_wide_u`, `i64.add128` and `i64.sub128`. It provides add, subtract, multiply, square, reduce, inversion, batch inversion, exponentiation, negation, packed-byte I/O and Montgomery conversion. It is the base field arithmetic of the `"wide"` curve backend, which implements the interface in `src/field-backend.ts` shared with the 29-bit arithmetic in `src/wasm/`.

```sh
npm run test-wide
npm run benchmark-wide
npm run benchmark-wide -- bn254-scalar # select fields
```

Both commands need a Node nightly that supports `--wasm-wide-arithmetic`; no Node release does yet.

## Usage and contracts

`Field.create(p)` builds a modulus-specific module. `Wasm` holds the pointer operations and `Memory.local` allocates field elements. `fromBigint()` and `toBigint()` convert to and from Montgomery form; `writeBigint()` and `readBigint()` access raw limbs.

With `n = ceil(bitLength(p) / 64)` and `R = 2^(64n)`, values are in `[0, 2p)` when `2p < R`, otherwise in `[0, p)`. `reduce()` canonicalizes, and raw equality checks need it first. Single-element operations allow the output to alias an input. `addNoReduce` and `subtractNoReduce` are raw operations modulo R whose results must be brought back into range before multiplication. Unlike the 29-bit backend there are no spare high bits, so curve formulas relying on loose ranges cannot use them directly. The curve backend therefore maps `addNoReduce` and `subtractPositive` to the reducing `add` and `subtract`.

`inverse(scratch, r, a)` needs three scratch elements and `batchInverse(scratch, z, x, n)` needs four. Scratch must be disjoint from inputs and output, and batch input and output must be disjoint. Inversion traps on zero and nonunits. `exp(x, z, xIn, n)` uses `x` as one scratch element and takes a raw exponent. `leftShift(xy, y, k)` computes `y * 2^k / R`, like the 29-bit version.

## Implementation notes

When `p + limit <= R`, multiplication is a single CIOS pass per row that interleaves the product and reduction carry chains, as in gnark's "no-carry" variant. Other moduli use CIOS with separate passes and an extra carry limb. Every multiply-add fits exactly in 128 bits. The generator drops the final subtraction when `4p <= R`, and it replaces multiplications by zero, one or power-of-two modulus limbs with shifts. On x64, V8 lowers each limb product to `mul` plus two `add`/`adc` pairs, so the kernel is bound by instruction count. Symmetric squaring needs fewer multiplications but more additions, and it measured slower than reusing the multiplication kernel.

Add and subtract select their result without branches. Their reduction condition is data dependent and mispredicts on random field elements. On dependent chains of a single operation, branches predict better, so subtraction looks slightly slower there; the affine addition benchmark below reflects MSM use. The rarely needed final subtraction of multiplication stays a branch.

`inverse` is a branchless batched binary GCD after Pornin (2020). b stays odd, and each step subtracts b from an odd a, swapping them if the difference is negative. All trailing zeros of a are removed at once, and the shift is computed from `a - b` in parallel with its absolute value. Each batch runs 62 steps on 63 high and 64 low bits of a and b, accumulating a 2x2 matrix of signed 64-bit entries, then applies it to the full values with wide products. A negative full value, caused by an approximation, is negated together with its matrix row. Coefficients are divided by `2^62` modulo p in every batch, and a final multiplication by `R^3` gives the Montgomery inverse. `inverseKaliski` is a simpler reference implementation.

The wide backend also exposes its arithmetic as kernels on locals (`src/wide/kernels.ts`), which the Wasm functions wrap. Curve formulas in `src/wasm/curve.ts` are written once against `src/wasm/formula.ts`. With kernels, each curve operation, including the batch-affine addition loop, is a single function that keeps its field elements in locals; the 29-bit backend runs the same formulas as calls to its field functions.

## Benchmarks

Nanoseconds per operation, 29-bit → wide, measured with `taskset -c 6 npm run benchmark-wide` on an AMD Ryzen 7 3700X with Node `v27.0.0-nightly20261006fcfb7ecc0b`. Arithmetic rows are dependent chains inside Wasm. The affine row runs the field operations of a batch-affine point addition over 1024 independent random inputs, with the same generated code for both backends. Inversion cycles 500,000 calls over the same 256 random inputs for both backends, after checking every output against bigint. The 29-bit fast inverse uses the earlier branching steps. Each row is a single run, and timings vary with server load.

| Field | Multiply | Square | Add | Subtract | Affine addition | Fast inverse | Kaliski inverse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Pallas | 36 → 17 | 28 → 16 | 13 → 7 | 8 → 6 | 164 → 85 | 2629 → 681 | 5344 → 3117 |
| BLS12-377 | 99 → 39 | 77 → 38 | 16 → 10 | 10 → 8 | 372 → 165 | 4338 → 1214 | 10774 → 6056 |
| BN254 scalar | 52 → 18 | 41 → 18 | 13 → 7 | 8 → 6 | 221 → 91 | 2582 → 692 | 5393 → 3113 |

End-to-end MSMs with `scripts/run-msm-*.ts <n> <threads> --evaluate --backend=<29-bit|wide>`, median of 10 runs, on the same machine under moderate load:

| Curve | Points | Threads | 29-bit | Wide |
| --- | ---: | ---: | ---: | ---: |
| Pallas | 2^16 | 1 | 410 ms | 190 ms |
| Pallas | 2^18 | 16 | 210 ms | 112 ms |
| BN254 | 2^18 | 16 | 239 ms | 115 ms |
| BLS12-377 | 2^18 | 16 | 454 ms | 219 ms |
| Edwards-on-BLS12-377 | 2^18 | 16 | 350 ms | 183 ms |
