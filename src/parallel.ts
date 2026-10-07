import type * as _W from "wasmati";
import type { WasmArtifacts } from "./types.ts";
import { createMsmField } from "./field-msm.ts";
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
import { createGlvScalar, type GlvScalarParams } from "./scalar-glv.ts";
import { createMsm, createMsmShared } from "./msm-batched-affine.ts";
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
import type { FieldBackendName, FieldBackendOption } from "./field-layout.ts";

export {
  startThreads,
  stopThreads,
  createWeierstraß,
  createTwistedEdwards,
  type Weierstraß,
  type TwistedEdwards,
  type WeierstraßWasm,
  type TwistedEdwardsWasm,
  type CurveOptions,
};

/**
 * - `backend`: base field arithmetic, see {@link FieldBackendOption}.
 *   Defaults to `"auto"`, which uses Wasm wide arithmetic when available.
 */
type CurveOptions = { backend?: FieldBackendOption };

/** compiled modules of a Weierstraß curve, which workers receive */
type WeierstraßWasm = {
  backend: FieldBackendName;
  field: WasmArtifacts;
  scalar: WasmArtifacts;
  glv: GlvScalarParams;
};

/** compiled modules of a twisted Edwards curve, which workers receive */
type TwistedEdwardsWasm = {
  backend: FieldBackendName;
  field: WasmArtifacts;
  scalar: WasmArtifacts;
};

// pool.register calls are at the bottom of this file — not here. They rely on
// `createWeierstraß.name` / `createTwistedEdwards.name`, which under esbuild's
// `keepNames` minification get patched by a helper inserted right after each
// function body. Registering before the function declarations runs before
// that patch, leaving us with the mangled name. Registering at the bottom
// (after the declarations) avoids the issue.

type Weierstraß = Awaited<ReturnType<typeof createWeierstraß>>;
type TwistedEdwards = Awaited<ReturnType<typeof createTwistedEdwards>>;

// curves, with what new workers need to create them
const curves: (
  | {
      module: Weierstraß;
      create: typeof createWeierstraß;
      wasm: WeierstraßWasm;
    }
  | {
      module: TwistedEdwards;
      create: typeof createTwistedEdwards;
      wasm: TwistedEdwardsWasm;
    }
)[] = [];

/**
 * Create a short Weierstrass curve from its parameters and compiled modules.
 * The main thread compiles them, see `Weierstraß.create` for modules generated
 * at runtime, and workers get them with the curve.
 *
 * This:
 * - instantiates the field and scalar modules;
 * - sets up affine, projective, and bigint-level curve operations, plus the
 *   batched-affine MSM;
 * - registers the curve with the thread pool. If the pool is already running,
 *   the curve is broadcast to existing workers immediately; otherwise, a
 *   later `startThreads` call will pick it up and segment its memory for the
 *   new thread count.
 *
 * Only curves with `a = 0` and a GLV endomorphism are supported.
 */
async function createWeierstraß(params: CurveParams, wasm: WeierstraßWasm) {
  let { modulus: p, endomorphism, a, b, label, cofactor: h } = params;
  let { backend } = wasm;
  assert(a === 0n, "only curves with a = 0 are supported");
  assert(endomorphism !== undefined, "endomorphism required");
  let { beta } = endomorphism;

  const Field = await createMsmField(
    { p, beta, backend, localRatio: 0.25 },
    wasm.field,
  );
  const Scalar = await createGlvScalar(wasm.glv, wasm.scalar);
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
    return await msmBasic(InputsProjective, scalars, pointsProj, N, options);
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

  curves.push({ module: Curve, create: createWeierstraß, wasm });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(createWeierstraß, params, wasm);
  }

  return Curve;
}

/**
 * Create a twisted Edwards curve from its parameters and compiled modules, like
 * {@link createWeierstraß}.
 */
async function createTwistedEdwards(
  params: TwistedEdwardsParams,
  wasm: TwistedEdwardsWasm,
) {
  let { modulus: p, order: q, label } = params;
  let { backend } = wasm;

  const Field = await createMsmField(
    { p, beta: 1n, backend, localRatio: 0.8 },
    wasm.field,
  );
  const Scalar = await createScalar({ q, w: 29 }, wasm.scalar);
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

  curves.push({ module: Module, create: createTwistedEdwards, wasm });

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(createTwistedEdwards, params, wasm);
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
    curves.map(({ module, create, wasm }) =>
      pool.callWorkers(create, module.params as any, wasm as any),
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
// `.name` patches have run and `createWeierstraß.name === "createWeierstraß"`
// (see comment at the top of this file)
pool.register("Weierstraß", createWeierstraß);
pool.register("Twisted Edwards", createTwistedEdwards);
