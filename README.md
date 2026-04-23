# montgomery: Fast MSM in WebAssembly

_by Gregor Mitscha-Baude_

**2nd place in the Wasm/MSM ZPrize in both 2022 and 2023.**

A fast, multi-threaded implementation of elliptic curve multi-scalar multiplication (MSM) in WebAssembly. Works in Node.js and the browser. The Wasm is generated at runtime from TypeScript via [wasmati](https://github.com/zksecurity/wasmati), so adding a new curve is a matter of plugging in its parameters.

## Install

```sh
npm install montgomery
```

### Runtime requirements

The library uses `SharedArrayBuffer` and `Atomics.waitAsync` for the worker pool. Neither can be polyfilled, so they set a hard floor on where montgomery runs.

| Runtime | Minimum version                                                    |
| ------- | ------------------------------------------------------------------ |
| Node.js | **24+** (for `using` declarations)                                 |
| Chrome  | 90                                                                 |
| Firefox | 145 (shipped Nov 2025 — earlier Firefox lacks `Atomics.waitAsync`) |
| Safari  | 16.4                                                               |

Browsers additionally need the page to be **cross-origin isolated** for `SharedArrayBuffer` to be exposed — serve with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

`using` declarations are used internally but compiled away in the web bundle, so browser support doesn't depend on them. If there is demand, we could do that for the Node.js build as well.

## Quick start

```ts
import { Pallas, startThreads, stopThreads, type AffinePoint } from "montgomery";

// lazy factory: instantiates the Pallas curve on first call
const pallas = await Pallas();
b
// optional: spin up worker threads to parallelize large MSMs
await startThreads(4);

// inputs — replace with your own points and scalars
const points: AffinePoint[] = /* ... */;
const scalars: bigint[] = /* ... */;

// write inputs to wasm memory
const scalarPtr = pallas.Scalar.fromBigints(scalars);
const pointPtr = pallas.Affine.fromBigints(points);

// compute msm
const { result } = await pallas.Parallel.msm(scalarPtr, pointPtr, scalars.length);

// read back the affine bigint result
const scratch = pallas.Field.local.getPointers(5);
const affinePtr = pallas.Field.getPointer(pallas.Affine.size);
pallas.Projective.toAffine(scratch, affinePtr, result);
const { x, y } = pallas.Affine.toBigint(affinePtr);

await stopThreads();
```

For performance-sensitive workloads, stream the inputs as raw bytes straight into wasm memory — see `Curve.Parallel.scalarsFromBytes` / `Curve.Parallel.pointsFromBytes`. The submission examples in `doc/zprize23/` show that pattern.

For best throughput on very large MSMs, `Curve.Parallel.msmUnsafe` skips the degenerate-addition check and is ~25% faster, but assumes the input points don't collide (the main application of the library is with pseudo-randomly generated points for prover-side computation, where the check is wasteful).

## Curves

Lazy factories, all in `montgomery`:

| Export      | Curve                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Pallas`    | [Pallas](https://electriccoin.co/blog/the-pasta-curves-for-halo-2-and-beyond/) (short Weierstrass, used in Halo 2 / Mina) |
| `Vesta`     | Vesta — Pallas' sister curve, base/scalar fields swapped                                                                  |
| `BLS12377`  | BLS12-377 (short Weierstrass, used in Aleo)                                                                               |
| `BLS12381`  | BLS12-381 (short Weierstrass, used in Ethereum / Zcash Sapling)                                                           |
| `BN254`     | BN254 / alt_bn128 G1 (short Weierstrass, used in Ethereum EIP-196/197 precompiles)                                        |
| `Secp256k1` | secp256k1 (short Weierstrass, used in Bitcoin / Ethereum signatures)                                                      |
| `Ed377`     | Edwards-on-BLS12-377 (twisted Edwards, used in Aleo)                                                                      |

Generic constructors `Weierstraß.create(params)` and `TwistedEdwards.create(params)` are also exported if you want to plug in your own curve parameters.

Under the hood, these constructors build a dedicated Wasm module on-the-fly based on the provided parameters, and makes sure to distribute that model to Workers when parallelism is enabled.

## Threads

Parallelism in both Node.js and browsers is supported by exposing methods to start and stop a global pool of workers. Performance-critical library methods like the MSM _automatically_ shard their work across the currently available pool.

`startThreads(n)` spins up a pool of `n` workers (defaults to `availableParallelism()`); `stopThreads()` terminates it. Safe to call before or after curve creation: the library tracks which curves exist and resegments their memory when the thread count changes.

If you skip `startThreads`, the library transparently falls back to single-threaded execution on the main thread, without any overhead compared to dedicated single-threaded implementations.

## Random points

`montgomery` has efficient random point and field element generation, suitable for testing:

```ts
const n = 1 << 16;

// both return an array of per-thread pointers; the first entry points at
// the full contiguous batch and is what msm wants
const [pointPtr] = await pallas.Parallel.randomPointsFast(n);
const [scalarPtr] = await pallas.Parallel.randomScalars(n);

const { result } = await pallas.Parallel.msmUnsafe(scalarPtr, pointPtr, n);
```

**Warning.** `randomPointsFast()` does **not** produce a cryptographically independent point basis. Each point is a random linear combination of a small precomputed basis, drawn from ~64 bits of entropy by default, so every output lives in a set of $2^{64}$ possible points. Fine for benchmarks and correctness tests; **not** safe for commitment schemes.

If you need an independent basis, `curve.Affine.randomPoints(ptrs)` (or `curve.Curve.randomPoints(ptrs)` on twisted edwards) samples each point from a random x-coordinate via a square root. Much slower (each point costs a sqrt), but cryptographically sound. It takes a pre-allocated pointer array:

```ts
const n = 1 << 10;
const ptrs = pallas.Field.global.getPointers(n, pallas.Affine.size);
pallas.Affine.randomPoints(ptrs);
// ptrs[0] is the pointer to the contiguous batch of n affine points
```

## Bigint / reference library

Every curve module ships with a pure-TS bigint reference implementation alongside the fast wasm one, exposed via `curve.Bigint`:

```ts
const pallas = await Pallas();

// bigint prime fields, with add/sub/mul/square/inverse/exp/sqrt/isSquare/random
const { Field, Scalar } = pallas.Bigint.Projective;

// bigint curve ops
pallas.Bigint.Affine.add(P, Q);
pallas.Bigint.Affine.scale(k, P);

// and a pippenger MSM for cross-checking the wasm one
const s = pallas.Bigint.Projective.msm(scalars, points);
```

For Weierstrass curves `curve.Bigint` has both `Affine` and `Projective` layers (each with `add`, `double`, `negate`, `scale`, `isEqual`, `isOnCurve`, `toSubgroup`, `random`, …). Twisted edwards has its single extended-projective layer at `curve.Bigint` directly. The bigint implementation is comparatively slow but small, simple, and matches the wasm one in behavior — used internally as the test oracle and handy for small-scale crypto (like signatures), tutorials, or building custom protocols in plain TS.

## Low-level arithmetic on Wasm pointers

Underneath the MSM, every curve exposes its full wasm field/scalar/curve arithmetic on raw pointers:

- `curve.Field` / `curve.Scalar` — `add`, `subtract`, `multiply`, `square`, `inverse`, `exp`, `sqrt`, `isEqual`, `isZero`, `reduce`, `toMontgomery`/`fromMontgomery`, `fromPackedBytes`/`toPackedBytes`, `writeBigint`/`readBigint`, …
- `curve.Affine` / `curve.Projective` (Weierstrass) or `curve.Curve` (twisted edwards) — `add`, `double`, `negate`, `scale`, `isOnCurve`, `batchNormalize`, `toBigint`/`writeBigint`, …

These are the same primitives the library's MSMs are built on: `msm-batched-affine.ts` (~590 lines of pure TS) and `msm-basic.ts` (~220 lines) touch no handwritten wasm — they compose the operations exposed on `curve.Field` / `curve.Affine` / `curve.Projective`. You can build other curve-level algorithms (pairings, zk-SNARK prover kernels, …) on the same API without leaving TypeScript.

A few highlights:

- **29×9 limb layout** for 256-bit fields. 29-bit limbs packed into 9 i64 lanes let the Montgomery multiplication use i64 multiplies with enough headroom in the upper bits to accumulate partial products before carrying — a sweet spot for wasm, which has no native 64×64→128 multiply. Bain Capital Crypto's [_Optimizing Montgomery Multiplication in WebAssembly_](https://baincapitalcrypto.com/optimizing-montgomery-multiplication-in-webassembly/) benchmarks several wasm multiplication variants against each other and finds this one (which they call "Mitscha-Baude's method", referencing this repo) the fastest.
- **Fast modular inverse** at **< 30 × MUL** cost, based on Pornin's "Optimized Binary GCD for Modular Inversion" ([eprint 2020/972](https://eprint.iacr.org/2020/972)). Much faster than the usual `exp(x, p-2)` Fermat trick.
- **Fast square root** via Tonelli–Shanks optimized after Daniel Bernstein's ["Faster square roots in annoying finite fields"](http://cr.yp.to/papers/sqroot.pdf): the discrete-log phase caches roots-of-unity windows so it drops to a handful of multiplications, leaving the `x^((t−1)/2)` exponentiation as the dominant cost.

## Constant-time: not a design goal

`montgomery` targets high-volume client-side computation (e.g. local SNARK provers) where the threat model does not include timing side channels: an adversary doesn't share the machine or observe wall-clock times of individual operations. Under that assumption we trade constant-time execution for raw throughput, and many core operations branch on their operands:

- `Field.inverse` — Pornin binary GCD with data-dependent branches
- `Field.sqrt` — Tonelli-Shanks with retry and lookup-driven digit extraction
- `Field.exp` — standard square-and-multiply, branches per exponent bit
- `Field.reduce` (and `Field.add` / `Field.subtract` through it) — conditional subtraction
- `Curve.scale`, `Curve.isOnCurve`, all MSM paths — inherit variable timing from the above

If your threat model does include timing side channels (server-side key operations, co-tenant environments, remote attackers), use a library built for constant-time execution instead.

## More

- Scripts in `scripts/` illustrate end-to-end use of each curve: `run-msm-pallas.ts`, `run-msm-377.ts`, `run-msm-ed-377.ts`, plus field-level benchmarks under `scripts/field-benchmarks/`.
- `doc/zprize23/` — the original ZPrize 2023 submission sources (twisted edwards + BLS12-377) and README, preserved as a reference.
