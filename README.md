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

| Export     | Curve                                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Pallas`   | [Pallas](https://electriccoin.co/blog/the-pasta-curves-for-halo-2-and-beyond/) (short Weierstrass, used in Halo 2 / Mina) |
| `BLS12377` | BLS12-377 (short Weierstrass, used in Aleo)                                                                               |
| `BLS12381` | BLS12-381 (short Weierstrass, used in Ethereum / Zcash Sapling)                                                           |
| `Ed377`    | Edwards-on-BLS12-377 (twisted Edwards, used in Aleo)                                                                      |

Generic constructors `Weierstraß.create(params)` and `TwistedEdwards.create(params)` are also exported if you want to plug in your own curve parameters.

## Threads

`startThreads(n)` spins up a pool of `n` workers (defaults to `availableParallelism()`); `stopThreads()` terminates it. Safe to call before or after curve creation: the library tracks which curves exist and resegments their memory when the thread count changes.

If you skip `startThreads`, the MSM transparently falls back to single-threaded execution on the main thread, without any overhead compared to a dedicated single-threaded implementation.

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

## More

- Scripts in `scripts/` illustrate end-to-end use of each curve: `run-msm-pallas.ts`, `run-msm-377.ts`, `run-msm-ed-377.ts`, plus field-level benchmarks under `scripts/field-benchmarks/`.
- `doc/zprize23/` — the original ZPrize 2023 submission sources (twisted edwards + BLS12-377) and README, preserved as a reference.
