import type * as _W from "wasmati";
import { WasmArtifacts } from "./types.js";
import { createMsmField } from "./field-msm.js";
import { createCurveProjective } from "./curve-projective.js";
import { createCurveProjective as createBigintCurve } from "./bigint/projective-weierstrass.js";
import { createCurveAffine } from "./curve-affine.js";
import {
  createRandomPointsFast,
  createRandomPointsFastSingleCurve,
  createRandomScalars,
} from "./curve-random.js";
import { GlvScalarParams, createGlvScalar } from "./scalar-glv.js";
import { createMsm } from "./msm-batched-affine.js";
import { pool } from "./threads/global-pool.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";
import { CurveParams as TwistedEdwardsParams } from "./bigint/twisted-edwards.js";
import { assert } from "./util.js";
import { createScalar } from "./scalar-simple.js";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.js";
import { createCurveTwistedEdwards as createBigintTE } from "./bigint/twisted-edwards.js";
import { createMsmBasic } from "./msm-basic.js";

export { startThreads, stopThreads, Weierstraß, TwistedEdwards };

pool.register("Weierstraß", createWeierstraß);
pool.register("Twisted Edwards", createTwistedEdwards);

type Weierstraß = Awaited<ReturnType<typeof createWeierstraß>>;
const Weierstraß = { create: createWeierstraß };

type TwistedEdwards = Awaited<ReturnType<typeof createTwistedEdwards>>;
const TwistedEdwards = { create: createTwistedEdwards };

const curves: (
  | { module: Weierstraß; create: typeof createWeierstraß }
  | { module: TwistedEdwards; create: typeof createTwistedEdwards }
)[] = [];

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
  const Field = await createMsmField({ p, beta, w: 29 }, fieldWasm);
  const Scalar = await createGlvScalar({ q, lambda, w: 29 }, scalarWasm);
  const Projective = createCurveProjective(Field, h);
  const Affine = createCurveAffine(Field, Projective, b);
  const Inputs = { params, Field, Scalar, Affine, Projective };

  const randomPointsFast = createRandomPointsFast(Inputs);
  const randomScalars = createRandomScalars(Inputs);
  const { msm, msmUnsafe } = createMsm(Inputs);
  // createMsmBasic({ Field, Scalar, Curve: Projective });

  function getPointer(size: number) {
    return Field.global.getPointer(size);
  }
  function getScalarPointer(size: number) {
    return Scalar.global.getPointer(size);
  }

  const Parallel = pool.register(`Weierstraß, ${label}`, {
    randomPointsFast,
    randomScalars,
    msmUnsafe,
    msm,
    getPointer,
    getScalarPointer,
  });

  const Bigint = { Projective: createBigintCurve(params) };

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

  const Parallel = pool.register(`Twisted Edwards, ${label}`, {
    randomPointsFast,
    randomScalars,
    msm,
    getPointer,
    getScalarPointer,
  });

  const Bigint = createBigintTE(params);

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

async function stopThreads() {
  await pool.stop();
  curves.forEach(({ module }) => module.Field.updateThreads());
}
