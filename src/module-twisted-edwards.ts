import type * as _W from "wasmati";
import { WasmArtifacts } from "./types.js";
import { createMsmField } from "./field-msm.js";
import { createCurveTwistedEdwards as createBigintCurve } from "./bigint/twisted-edwards.js";
import {
  createRandomPointsFastSingleCurve,
  createRandomScalars,
} from "./curve-random.js";
import { pool } from "./threads/global-pool.js";
import { CurveParams } from "./bigint/twisted-edwards.js";
import { createScalar } from "./scalar-simple.js";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.js";
import { createMsmBasic } from "./msm-basic.js";

export { create, startThreads, stopThreads, TwistedEdwards };

pool.register("Twisted Edwards", create);

type TwistedEdwards = Awaited<ReturnType<typeof create>>;
const TwistedEdwards = { create, startThreads, stopThreads };

const curves: TwistedEdwards[] = [];

async function create(
  params: CurveParams,
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

  const Bigint = createBigintCurve(params);

  const Module = {
    params,

    Field,
    Scalar,
    Curve,
    Parallel,
    Bigint,
  };

  (curves as (typeof Module)[]).push(Module);

  // if the pool is already running, send wasm modules for the new curve to the workers
  // note: this code also runs in workers, but in their process, the pool is never running, and there are no workers to call
  if (pool.isRunning) {
    await pool.callWorkers(
      create,
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
  curves.forEach((curve) => curve.Field.updateThreads());

  // send wasm modules to newly created workers
  await Promise.all(
    curves.map((curve) =>
      pool.callWorkers(
        create,
        curve.params,
        curve.Field.wasmArtifacts,
        curve.Scalar.wasmArtifacts
      )
    )
  );
}

async function stopThreads() {
  await pool.stop();
  curves.forEach((curve) => curve.Field.updateThreads());
}
