# Wide arithmetic experiment

Field arithmetic with full-width 64-bit Montgomery limbs, using the Wasm wide arithmetic instructions `i64.mul_wide_u`, `i64.add128` and `i64.sub128`. It provides add, subtract, multiply, square, reduce, inversion, batch inversion, exponentiation, negation, packed-byte I/O and Montgomery conversion. Wasm function and parameter names match the 29-bit backend in `src/wasm/`. Curve and MSM integration is not implemented.

```sh
npm run test-wide
npm run benchmark-wide
npm run benchmark-wide -- bn254-scalar # select fields
```

Both commands need a Node nightly that supports `--wasm-wide-arithmetic`; no Node release does yet.

## Usage and contracts

`Field.create(p)` builds a modulus-specific module. `Wasm` holds the pointer operations and `Memory.local` allocates field elements. `fromBigint()` and `toBigint()` convert to and from Montgomery form; `writeBigint()` and `readBigint()` access raw limbs.

With `n = ceil(bitLength(p) / 64)` and `R = 2^(64n)`, values are in `[0, 2p)` when `2p < R`, otherwise in `[0, p)`. `reduce()` canonicalizes, and raw equality checks need it first. Single-element operations allow the output to alias an input. `addNoReduce` and `subtractNoReduce` are raw operations modulo R whose results must be brought back into range before multiplication. Unlike the 29-bit backend there are no spare high bits, so curve formulas relying on loose ranges cannot use them directly.

`inverse(scratch, r, a)` needs three scratch elements and `batchInverse(scratch, z, x, n)` needs four. Scratch must be disjoint from inputs and output, and batch input and output must be disjoint. Inversion traps on zero and nonunits. `exp(x, z, xIn, n)` uses `x` as one scratch element and takes a raw exponent. `leftShift(xy, y, k)` computes `y * 2^k / R`, like the 29-bit version.

## Implementation notes

Multiplication is CIOS with separate product and reduction passes, so every multiply-add fits exactly in 128 bits. The generator drops the final subtraction when `4p <= R`, drops the extra carry limb when `p + limit <= R`, and specializes zero and one modulus limbs. Squaring reuses the multiplication kernel and does not exploit symmetric cross products.

`inverse` is a batched binary GCD. Each batch accumulates 62 steps in a 2x2 matrix from high/low approximations, then applies the matrix to the full remainders with signed wide products. A negative remainder is negated together with its matrix row. Coefficients are divided by `2^62` modulo p in every batch, so they stay canonical, and one final multiplication by `R^3` gives the Montgomery inverse. The 29-bit fast inverse in `src/inverse/faster-inverse-wasm.ts` uses the same scheme with 29-step batches. `inverseKaliski` is a simpler reference implementation.

## Benchmarks

Nanoseconds per operation, 29-bit → wide, measured with `taskset -c 2 npm run benchmark-wide` on an AMD Ryzen 7 3700X with Node `v27.0.0-nightly20261006fcfb7ecc0b`. Arithmetic runs dependent chains inside Wasm. Inversion cycles 500,000 calls over the same 256 random inputs for both backends, after checking every output against bigint. Each row is a single run, and timings vary with server load.

| Field | Multiply | Square | Add | Subtract | Fast inverse | Kaliski inverse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Pallas | 37 → 18 | 28 → 18 | 13 → 9 | 8 → 5 | 2648 → 1960 | 5529 → 3145 |
| BLS12-377 | 100 → 40 | 77 → 39 | 16 → 10 | 11 → 7 | 4401 → 3142 | 10773 → 6119 |
| BN254 scalar | 52 → 19 | 41 → 19 | 13 → 9 | 8 → 5 | 2573 → 1963 | 5511 → 3196 |
