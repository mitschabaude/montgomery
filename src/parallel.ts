import type * as _W from "wasmati";
import { type WasmArtifacts } from "./types.ts";
import { compileField, createFieldFromWasm } from "./field-msm.ts";
import { createCurveProjective } from "./curve-projective.ts";
import {
  createCurveProjective as createBigintCurve,
  type BigintPoint as ProjectivePoint,
} from "./bigint/projective-weierstrass.ts";
import { createCurveAffine as createBigintAffine } from "./bigint/affine-weierstrass.ts";
import { createCurveAffine } from "./curve-affine.ts";
import { msm as bigintMsm } from "./bigint/msm.ts";
import {
  createRandomPointsFast,
  createRandomPointsFastSingleCurve,
  createRandomScalars,
} from "./curve-random.ts";
import {
  type GlvScalarParams,
  compileGlvScalar,
  createGlvScalarFromWasm,
} from "./scalar-glv.ts";
import { createMsm, createMsmShared } from "./msm-batched-affine.ts";
import { pool } from "./threads/global-pool.ts";
import {
  type CurveParams,
  computeEndomorphism,
} from "./bigint/affine-weierstrass.ts";
import { type CurveParams as TwistedEdwardsParams } from "./bigint/twisted-edwards.ts";
import { assert } from "./util.ts";
import { compileScalar, createScalarFromWasm } from "./scalar-simple.ts";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.ts";
import {
  createCurveTwistedEdwards as createBigintTE,
  type BigintPoint as TwistedEdwardsPoint,
} from "./bigint/twisted-edwards.ts";
import { createMsmBasic, msmBasic } from "./msm-basic.ts";
import { barrier, isMain, range } from "./threads/threads.ts";
import {
  resolveFieldBackend,
  type FieldBackendName,
  type FieldBackendOption,
} from "./field-backend.ts";

export {
  startThreads,
  stopThreads,
  Weierstraß,
  TwistedEdwards,
  type CurveOptions,
};

/**
 * - `backend`: base field arithmetic, see {@link FieldBackendOption}.
 *   Defaults to `"auto"`, which uses Wasm wide arithmetic when available.
 */
type CurveOptions = { backend?: FieldBackendOption };

// pool.register calls are at the bottom of this file — not here. They rely on
// `createWeierstraßFromWasm.name` / `createTwistedEdwardsFromWasm.name`, which
// under esbuild's `keepNames` minification get patched by a helper inserted
// right after each function body. Registering before the function declarations runs before
// that patch, leaving us with the mangled name. Registering at the bottom
// (after the declarations) avoids the issue.

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
  | { module: Weierstraß; create: typeof createWeierstraßFromWasm }
  | { module: TwistedEdwards; create: typeof createTwistedEdwardsFromWasm }
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
 * Only curves with `a = 0` are supported, which have a GLV endomorphism. If
 * `params` leave it out, it is computed, which costs a scalar multiplication.
 *
 * @param options see {@link CurveOptions}
 */
async function createWeierstraß(
  params: CurveParams,
  options: CurveOptions = {},
) {
  let { modulus: p, order: q, a } = params;
  let backend = resolveFieldBackend(options.backend ?? "auto");
  assert(a === 0n, "only curves with a = 0 are supported");
  let endomorphism = params.endomorphism ?? computeEndomorphism(params);
  params = { ...params, endomorphism };
  let { beta, lambda } = endomorphism;

  let fieldWasm = await compileField({
    p,
    curve: "weierstraß",
    beta,
    backend,
  });
  let scalarWasm = await compileGlvScalar({ q, lambda, w: 29 });
  return await createWeierstraßFromWasm(params, backend, fieldWasm, scalarWasm);
}

/**
 * Create a short Weierstrass curve from compiled wasm modules.
 *
 * This is the part of {@link createWeierstraß} that runs on every thread: the
 * main thread broadcasts its compiled modules to workers, so workers neither
 * recompile them nor need to load the wasm code generator.
 */
async function createWeierstraßFromWasm(
  params: CurveParams,
  backend: FieldBackendName,
  fieldWasm: WasmArtifacts,
  scalarWasm: { wasm: WasmArtifacts; fullParams: GlvScalarParams },
) {
  let { modulus: p, b, label } = params;

  const Field = await createFieldFromWasm(
    { p, curve: "weierstraß", backend, localRatio: 0.25 },
    fieldWasm,
  );
  const Scalar = await createGlvScalarFromWasm(
    scalarWasm.fullParams,
    scalarWasm.wasm,
  );
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
    options?: { c?: number },
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
    let { result, log } = await msmBasic(
      InputsProjective,
      scalars,
      pointsProj,
      N,
      options,
    );
    // return an affine point, like the batched-affine MSM. global memory is
    // allocated the same way on all threads
    let affine = Field.global.getPointer(Affine.size);
    if (!isMain()) return { result: affine, log };
    using _ = Field.local.atCurrentOffset;
    Projective.toAffine(Field.local.getPointers(5), affine, result);
    return { result: affine, log };
  }

  function getPointer(size: number) {
    return Field.global.getPointer(size);
  }
  function getScalarPointer(size: number) {
    return Scalar.global.getPointer(size);
  }

  /**
   * Convert input bytes already present in wasm memory to affine points.
   *
   * Byte layout per point: `packedX || packedY`, where each coordinate is
   * `Field.packedSizeField = ceil(bitLength / 8)` bytes in little-endian
   * packed form (see {@link fromPackedBytes}). No encoding for the point at
   * infinity — `isNonZero` is set unconditionally, so callers must filter
   * infinity points out before passing them in.
   */
  function pointsFromBytes(pointPtr: number, pointInputPtr: number, n: number) {
    let { size } = Affine;
    let { fromPackedBytes, sizeField, toMontgomery, memoryBytes } = Field;
    let packedSize = Field.packedSizeField;
    let bytesPerPoint = 2 * packedSize;

    let [i, iend] = range(n);
    let pi = pointPtr + i * size;
    let bi = pointInputPtr + i * bytesPerPoint;

    for (; i < iend; i++, pi += size, bi += bytesPerPoint) {
      let x = pi;
      let y = x + sizeField;
      // set nonzero flag. (input format doesn't allow zero points, so always 1)
      memoryBytes[pi + 2 * sizeField] = 1;

      fromPackedBytes(x, bi);
      fromPackedBytes(y, bi + packedSize);
      toMontgomery(x);
      toMontgomery(y);
    }
  }

  /**
   * Convert input bytes already present in wasm memory to scalars.
   *
   * Byte layout per scalar: `Scalar.packedSizeField` bytes in little-endian
   * packed form (see {@link fromPackedBytes}).
   */
  function scalarsFromBytes(
    scalarPtr: number,
    scalarInputPtr: number,
    n: number,
  ) {
    let { fromPackedBytes, sizeField: size } = Scalar;
    let packedSize = Scalar.packedSizeField;

    let [i, iend] = range(n);
    let si = scalarPtr + i * size;
    let bi = scalarInputPtr + i * packedSize;

    for (; i < iend; i++, si += size, bi += packedSize) {
      fromPackedBytes(si, bi);
    }
  }

  const ParallelApi = pool.register(`Weierstraß, ${label}, ${backend}`, {
    randomPointsFast,
    randomScalars,
    msmUnsafe,
    msm,
    msmProjective,
    getPointer,
    getScalarPointer,
    scalarsFromBytes,
    pointsFromBytes,
  });
  // the main thread creates the state that all threads of an MSM share
  const Parallel = {
    ...ParallelApi,
    msm: (...[s, p, N, verbose, options]: Parameters<typeof msm>) =>
      ParallelApi.msm(s, p, N, verbose, options, createMsmShared()),
    msmUnsafe: (...[s, p, N, verbose, options]: Parameters<typeof msmUnsafe>) =>
      ParallelApi.msmUnsafe(s, p, N, verbose, options, createMsmShared()),
  };

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

  curves.push({ module: Curve, create: createWeierstraßFromWasm });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      createWeierstraßFromWasm,
      Curve.params,
      backend,
      Curve.Field.wasmArtifacts,
      Curve.Scalar.wasmArtifacts,
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
 * @param options see {@link CurveOptions}
 */
async function createTwistedEdwards(
  params: TwistedEdwardsParams,
  options: CurveOptions = {},
) {
  let { modulus: p, order: q } = params;
  let backend = resolveFieldBackend(options.backend ?? "auto");

  let fieldWasm = await compileField({ p, curve: "twisted-edwards", backend });
  let scalarWasm = await compileScalar({ q, w: 29 });
  return await createTwistedEdwardsFromWasm(
    params,
    backend,
    fieldWasm,
    scalarWasm,
  );
}

/**
 * Create a twisted edwards curve from compiled wasm modules, like
 * {@link createWeierstraßFromWasm}.
 */
async function createTwistedEdwardsFromWasm(
  params: TwistedEdwardsParams,
  backend: FieldBackendName,
  fieldWasm: WasmArtifacts,
  scalarWasm: WasmArtifacts,
) {
  let { modulus: p, order: q, label } = params;

  const Field = await createFieldFromWasm(
    { p, curve: "twisted-edwards", backend, localRatio: 0.8 },
    fieldWasm,
  );
  const Scalar = await createScalarFromWasm({ q, w: 29 }, scalarWasm);
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

  /**
   * Convert input bytes already present in wasm memory to extended-projective
   * points.
   *
   * Byte layout per point: `packedX || packedY`, where each coordinate is
   * `Field.packedSizeField = ceil(bitLength / 8)` bytes in little-endian
   * packed form (see {@link fromPackedBytes}). Z and T are derived from x, y.
   */
  function pointsFromBytes(pointPtr: number, pointInputPtr: number, n: number) {
    let { size } = Curve;
    let { fromPackedBytes, sizeField, toMontgomery, copy, multiply } = Field;
    let packedSize = Field.packedSizeField;
    let bytesPerPoint = 2 * packedSize;

    let [i, iend] = range(n);
    let pi = pointPtr + i * size;
    let bi = pointInputPtr + i * bytesPerPoint;

    for (; i < iend; i++, pi += size, bi += bytesPerPoint) {
      let x = pi;
      let y = x + sizeField;
      let z = y + sizeField;
      let t = z + sizeField;

      fromPackedBytes(x, bi);
      fromPackedBytes(y, bi + packedSize);

      toMontgomery(x);
      toMontgomery(y);
      copy(z, Field.constants.mg1);
      multiply(t, x, y);
    }
    return pointPtr;
  }

  /**
   * Convert input bytes already present in wasm memory to scalars.
   *
   * Byte layout per scalar: `Scalar.packedSizeField` bytes in little-endian
   * packed form (see {@link fromPackedBytes}).
   */
  function scalarsFromBytes(
    scalarPtr: number,
    scalarInputPtr: number,
    n: number,
  ) {
    let { fromPackedBytes, sizeField: size } = Scalar;
    let packedSize = Scalar.packedSizeField;

    let [i, iend] = range(n);
    let si = scalarPtr + i * size;
    let bi = scalarInputPtr + i * packedSize;

    for (; i < iend; i++, si += size, bi += packedSize) {
      fromPackedBytes(si, bi);
    }
  }

  const Parallel = pool.register(`Twisted Edwards, ${label}, ${backend}`, {
    randomPointsFast,
    randomScalars,
    msm,
    getPointer,
    getScalarPointer,
    pointsFromBytes,
    scalarsFromBytes,
  });

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

  curves.push({ module: Module, create: createTwistedEdwardsFromWasm });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      createTwistedEdwardsFromWasm,
      Module.params,
      backend,
      Module.Field.wasmArtifacts,
      Module.Scalar.wasmArtifacts,
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
        module.Field.backend,
        module.Field.wasmArtifacts,
        module.Scalar.wasmArtifacts as any,
      ),
    ),
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

// registered after the function declarations above so that keepNames-inserted
// `.name` patches have run and the functions have their original names
// (see comment at the top of this file)
pool.register("Weierstraß", createWeierstraßFromWasm);
pool.register("Twisted Edwards", createTwistedEdwardsFromWasm);
