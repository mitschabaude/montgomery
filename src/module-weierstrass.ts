import type * as _W from "wasmati";
import { WasmArtifacts } from "./types.js";
import { createMsmField } from "./field-msm.js";
import { createCurveProjective } from "./curve-projective.js";
import { createCurveProjective as createBigintCurve } from "./bigint/projective-weierstrass.js";
import { createCurveAffine } from "./curve-affine.js";
import { createRandomPointsFast, createRandomScalars } from "./curve-random.js";
import { GlvScalarParams, createGlvScalar } from "./scalar-glv.js";
import { createMsm } from "./msm-parallel.js";
import { pool } from "./threads/global-pool.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";
import { assert } from "./util.js";

export { create, startThreads, stopThreads, Weierstraß };

pool.register("Weierstraß", create);

type Weierstraß = Awaited<ReturnType<typeof create>>;

const curves: Weierstraß[] = [];

async function create(
  params: CurveParams,
  wasm?: WasmArtifacts,
  scalarWasmParams?: { wasm: WasmArtifacts; fullParams: GlvScalarParams }
) {
  let { modulus: p, order: q, endomorphism, a, b, label, cofactor: h } = params;
  assert(a === 0n, "only curves with a = 0 are supported");
  assert(endomorphism !== undefined, "endomorphism required");
  let { beta, lambda } = endomorphism;

  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField({ p, beta, w: 29 }, wasm);
  const Scalar = await createGlvScalar({ q, lambda, w: 29 }, scalarWasmParams);
  const Projective = createCurveProjective(Field, h);
  const Affine = createCurveAffine(Field, Projective, b);
  const Inputs = {
    Field,
    Scalar,
    Affine,
    Projective,
  };

  const randomPointsFast = createRandomPointsFast(Inputs);
  const randomScalars = createRandomScalars(Inputs);
  const { msm, msmUnsafe } = createMsm(Inputs);

  const Parallel = pool.register(`Weierstraß-${label}`, {
    randomPointsFast,
    randomScalars,
    msmUnsafe,
    msm,
  });

  const Bigint = {
    Projective: createBigintCurve(params),
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

  (curves as (typeof Curve)[]).push(Curve);

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      create,
      Curve.params,
      Curve.Field.wasmArtifacts,
      Curve.Scalar.wasmParams
    );
  }

  return Curve;
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
  curves.forEach((curve) => curve.Field.updateThreads());

  // send wasm modules to workers
  await Promise.all(
    curves.map((curve) =>
      pool.callWorkers(
        create,
        curve.params,
        curve.Field.wasmArtifacts,
        curve.Scalar.wasmParams
      )
    )
  );
}

async function stopThreads() {
  await pool.stop();
  curves.forEach((curve) => curve.Field.updateThreads());
}
