import type * as _W from "wasmati";
import { type WasmArtifacts } from "./types.ts";
import { createMsmField } from "./field-msm.ts";
import { createCurveProjective } from "./curve-projective.ts";
import {
  createCurveProjective as createBigintCurve,
  type BigintPoint as ProjectivePoint,
} from "./bigint/projective-weierstrass.ts";
import {
  createCurveAffine as createBigintAffine,
  type BigintPoint as AffinePoint,
} from "./bigint/affine-weierstrass.ts";
import { createCurveAffine } from "./curve-affine.ts";
import { msm as bigintMsm } from "./bigint/msm.ts";
import {
  createRandomPointsFast,
  createRandomPointsFastSingleCurve,
  createRandomScalars,
} from "./curve-random.ts";
import { type GlvScalarParams, createGlvScalar } from "./scalar-glv.ts";
import { createMsm } from "./msm-batched-affine.ts";
import { pool } from "./threads/global-pool.ts";
import { type CurveParams } from "./bigint/affine-weierstrass.ts";
import { type CurveParams as TwistedEdwardsParams } from "./bigint/twisted-edwards.ts";
import { assert } from "./util.ts";
import { createScalar } from "./scalar-simple.ts";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.ts";
import {
  createCurveTwistedEdwards as createBigintTE,
  type BigintPoint as TwistedEdwardsPoint,
} from "./bigint/twisted-edwards.ts";
import { createMsmBasic, msmBasic } from "./msm-basic.ts";
import { barrier, range } from "./threads/threads.ts";

export { startThreads, stopThreads, Weierstraß, TwistedEdwards };

pool.register("Weierstraß", createWeierstraß);
pool.register("Twisted Edwards", createTwistedEdwards);

/**
 * Short Weierstrass curve with batched-affine additions and GLV-endomorphism
 * accelerated scalar multiplication. Instantiate with `Weierstraß.create(params)`.
 */
type Weierstraß = Awaited<ReturnType<typeof createWeierstraß>>;
const Weierstraß = { create: createWeierstraß };

/**
 * Twisted Edwards curve with projective additions. Instantiate with
 * `TwistedEdwards.create(params)`.
 */
type TwistedEdwards = Awaited<ReturnType<typeof createTwistedEdwards>>;
const TwistedEdwards = { create: createTwistedEdwards };

const curves: (
  | { module: Weierstraß; create: typeof createWeierstraß }
  | { module: TwistedEdwards; create: typeof createTwistedEdwards }
)[] = [];

/**
 * Create a short Weierstrass curve from its parameters.
 *
 * Under the hood, this:
 * - generates wasm modules for the field and scalar arithmetic (via
 *   {@link https://github.com/zksecurity/wasmati | wasmati}) and instantiates
 *   them;
 * - sets up affine, projective, and bigint-level curve operations, plus the
 *   batched-affine MSM;
 * - registers the curve with the thread pool. If the pool is already running,
 *   the curve is broadcast to existing workers immediately; otherwise, a
 *   later `startThreads` call will pick it up and segment its memory for the
 *   new thread count.
 *
 * Only curves with `a = 0` and a GLV endomorphism are supported.
 *
 * @param fieldWasm / @param scalarWasm are used internally when the main
 * thread broadcasts a curve to workers, so workers reuse the main thread's
 * compiled wasm instead of recompiling.
 */
async function createWeierstraß(
  params: CurveParams,
  fieldWasm?: WasmArtifacts,
  scalarWasm?: { wasm: WasmArtifacts; fullParams: GlvScalarParams }
) {
  let { modulus: p, order: q, endomorphism, a, b, label, cofactor: h } = params;
  assert(a === 0n, "only curves with a = 0 are supported");
  assert(endomorphism !== undefined, "endomorphism required");
  let { beta, lambda } = endomorphism;

  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField(
    { p, beta, w: 29, localRatio: 0.25 },
    fieldWasm
  );
  const Scalar = await createGlvScalar({ q, lambda, w: 29 }, scalarWasm);
  const Projective = createCurveProjective(Field, params);
  const Affine = createCurveAffine(Field, Projective, b);
  const Inputs = { params, Field, Scalar, Affine, Projective };

  const randomPointsFast = createRandomPointsFast(Inputs);
  const randomScalars = createRandomScalars(Inputs);

  const { msm, msmUnsafe } = createMsm(Inputs);

  const InputsProjective = { Field, Scalar: Scalar.Simple, Curve: Projective };

  async function msmProjective(
    scalars: number,
    points: number,
    N: number,
    options?: { c?: number }
  ) {
    // expect affine points, convert to projective
    let pointsProj = Field.global.getPointer(Projective.size * N);
    let [i, iend] = range(N);
    for (
      let pi = pointsProj + i * Projective.size, ai = points + i * Affine.size;
      i < iend;
      i++, pi += Projective.size, ai += Affine.size
    ) {
      Projective.fromAffine(pi, ai);
    }
    await barrier();
    return await msmBasic(InputsProjective, scalars, pointsProj, N, options);
  }

  function getPointer(size: number) {
    return Field.global.getPointer(size);
  }
  function getScalarPointer(size: number) {
    return Scalar.global.getPointer(size);
  }

  // input bytes must be transfered to wasm memory before calling this function
  function pointsFromBytes(pointPtr: number, pointInputPtr: number, n: number) {
    let { size } = Affine;
    let { fromPackedBytes, sizeField, toMontgomery, memoryBytes } = Field;

    let [i, iend] = range(n);
    let pi = pointPtr + i * size;
    let bi = pointInputPtr + i * 96;

    for (; i < iend; i++, pi += size, bi += 96) {
      let x = pi;
      let y = x + sizeField;
      // set nonzero flag. (input format doesn't allow zero points, so always 1)
      memoryBytes[pi + 2 * sizeField] = 1;

      fromPackedBytes(x, bi);
      fromPackedBytes(y, bi + 48);
      toMontgomery(x);
      toMontgomery(y);
    }
  }

  // input bytes must be transfered to wasm memory before calling this function
  function scalarsFromBytes(
    scalarPtr: number,
    scalarInputPtr: number,
    n: number
  ) {
    let { fromPackedBytes, sizeField: size } = Scalar;

    let [i, iend] = range(n);
    let si = scalarPtr + i * size;
    let bi = scalarInputPtr + i * 32;

    for (; i < iend; i++, si += size, bi += 32) {
      fromPackedBytes(si, bi);
    }
  }

  // main-thread-only helpers: bigints don't survive the worker boundary, so
  // these are attached to `Parallel` after `pool.register` rather than being
  // part of the broadcast interface
  function scalarsFromBigint(scalars: bigint[]): number {
    let n = scalars.length;
    let ptr = Scalar.global.getPointer(n * Scalar.sizeField);
    for (let i = 0, si = ptr; i < n; i++, si += Scalar.sizeField) {
      Scalar.writeBigint(si, scalars[i]);
    }
    return ptr;
  }
  function pointsFromBigint(points: AffinePoint[]): number {
    let ptr = Field.global.getPointer(points.length * Affine.size);
    Affine.writeBigints(ptr, points);
    return ptr;
  }

  const Parallel = Object.assign(
    pool.register(`Weierstraß, ${label}`, {
      randomPointsFast,
      randomScalars,
      msmUnsafe,
      msm,
      msmProjective,
      getPointer,
      getScalarPointer,
      scalarsFromBytes,
      pointsFromBytes,
    }),
    { scalarsFromBigint, pointsFromBigint }
  );

  const bigintProjective = createBigintCurve(params);
  const Bigint = {
    Affine: createBigintAffine(params),
    Projective: Object.assign(bigintProjective, {
      msm(scalars: bigint[], points: ProjectivePoint[]) {
        return bigintMsm(bigintProjective, scalars, points);
      },
    }),
  };

  const Curve = {
    params,

    Field,
    Scalar,
    Affine,
    Projective,
    Parallel,
    Bigint,
  };

  (curves as { module: typeof Curve; create: typeof createWeierstraß }[]).push({
    module: Curve,
    create: createWeierstraß,
  });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      createWeierstraß,
      Curve.params,
      Curve.Field.wasmArtifacts,
      Curve.Scalar.wasmArtifacts
    );
  }

  return Curve;
}

/**
 * Create a twisted edwards curve (`-x^2 + y^2 = 1 + d*x^2*y^2`) from its
 * parameters.
 *
 * Under the hood, this:
 * - generates wasm modules for the field and scalar arithmetic (via
 *   {@link https://github.com/zksecurity/wasmati | wasmati}) and instantiates
 *   them;
 * - sets up projective-extended curve ops and the generic (non-batched) MSM;
 * - registers the curve with the thread pool. If the pool is already running,
 *   the curve is broadcast to existing workers immediately; otherwise, a
 *   later `startThreads` call will pick it up and segment its memory for the
 *   new thread count.
 *
 * @param fieldWasm / @param scalarWasm are used internally when the main
 * thread broadcasts a curve to workers, so workers reuse the main thread's
 * compiled wasm instead of recompiling.
 */
async function createTwistedEdwards(
  params: TwistedEdwardsParams,
  fieldWasm?: WasmArtifacts,
  scalarWasm?: WasmArtifacts
) {
  let { modulus: p, order: q, label } = params;

  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField(
    { p, beta: 1n, w: 29, localRatio: 0.8 },
    fieldWasm
  );
  const Scalar = await createScalar({ q, w: 29 }, scalarWasm);
  const Curve = createCurveTwistedEdwards(Field, params);
  const Inputs = { params, Field, Scalar, Curve };

  const randomPointsFast = createRandomPointsFastSingleCurve(Inputs);
  const randomScalars = createRandomScalars(Inputs);
  const msm = createMsmBasic(Inputs);

  function getPointer(size: number) {
    return Field.global.getPointer(size);
  }
  function getScalarPointer(size: number) {
    return Scalar.global.getPointer(size);
  }

  // input bytes must be transfered to wasm memory before calling this function
  function pointsFromBytes(pointPtr: number, pointInputPtr: number, n: number) {
    let { size } = Curve;
    let { fromPackedBytes, sizeField, toMontgomery, copy, multiply } = Field;

    let [i, iend] = range(n);
    let pi = pointPtr + i * size;
    let bi = pointInputPtr + i * 64;

    for (; i < iend; i++, pi += size, bi += 64) {
      let x = pi;
      let y = x + sizeField;
      let z = y + sizeField;
      let t = z + sizeField;

      fromPackedBytes(x, bi);
      fromPackedBytes(y, bi + 32);

      toMontgomery(x);
      toMontgomery(y);
      copy(z, Field.constants.mg1);
      multiply(t, x, y);
    }
    return pointPtr;
  }

  // input bytes must be transfered to wasm memory before calling this function
  function scalarsFromBytes(
    scalarPtr: number,
    scalarInputPtr: number,
    n: number
  ) {
    let { fromPackedBytes, sizeField: size } = Scalar;

    let [i, iend] = range(n);
    let si = scalarPtr + i * size;
    let bi = scalarInputPtr + i * 32;

    for (; i < iend; i++, si += size, bi += 32) {
      fromPackedBytes(si, bi);
    }
  }

  // main-thread-only helpers: bigints don't survive the worker boundary, so
  // these are attached to `Parallel` after `pool.register` rather than being
  // part of the broadcast interface
  function scalarsFromBigint(scalars: bigint[]): number {
    let n = scalars.length;
    let ptr = Scalar.global.getPointer(n * Scalar.sizeField);
    for (let i = 0, si = ptr; i < n; i++, si += Scalar.sizeField) {
      Scalar.writeBigint(si, scalars[i]);
    }
    return ptr;
  }
  function pointsFromBigint(points: { x: bigint; y: bigint }[]): number {
    let ptr = Field.global.getPointer(points.length * Curve.size);
    Curve.fromAffineBigints(ptr, points);
    return ptr;
  }

  const Parallel = Object.assign(
    pool.register(`Twisted Edwards, ${label}`, {
      randomPointsFast,
      randomScalars,
      msm,
      getPointer,
      getScalarPointer,
      pointsFromBytes,
      scalarsFromBytes,
    }),
    { scalarsFromBigint, pointsFromBigint }
  );

  const bigintTE = createBigintTE(params);
  const Bigint = Object.assign(bigintTE, {
    msm(scalars: bigint[], points: TwistedEdwardsPoint[]) {
      return bigintMsm(bigintTE, scalars, points);
    },
  });

  const Module = {
    params,

    Field,
    Scalar,
    Curve,
    Parallel,
    Bigint,
  };

  (
    curves as { module: typeof Module; create: typeof createTwistedEdwards }[]
  ).push({ module: Module, create: createTwistedEdwards });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      createTwistedEdwards,
      Module.params,
      Module.Field.wasmArtifacts,
      Module.Scalar.wasmArtifacts
    );
  }

  return Module;
}

/**
 * Start a worker thread pool with `n` workers (defaults to available cores).
 * Safe to call before or after curves are created: curves created earlier
 * get broadcast to the new workers, and their memory is resegmented for the
 * new thread count.
 */
async function startThreads(n?: number) {
  // in the web build, we inline a bundle of this file, to become the worker source code
  // import.meta.url is replaced with a blob url created on-the-fly from the inlined source code
  let source: string;
  INLINE_META_URL: source = import.meta.url;
  pool.setSource(source);
  await pool.start(n);
  URL.revokeObjectURL(source); // no-op in node, intended to free memory in the browser

  // the memory is segmented differently depending on # of threads
  // so there is this method to resegment when the # of threads changed
  curves.forEach(({ module }) => module.Field.updateThreads());

  // send wasm modules to newly created workers
  await Promise.all(
    curves.map(({ module, create }) =>
      pool.callWorkers(
        create,
        module.params as any,
        module.Field.wasmArtifacts,
        module.Scalar.wasmArtifacts as any
      )
    )
  );
}

/**
 * Terminate the worker thread pool and resegment existing curves' memory
 * for single-threaded use.
 */
async function stopThreads() {
  await pool.stop();
  curves.forEach(({ module }) => module.Field.updateThreads());
}
