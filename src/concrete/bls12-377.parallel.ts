import type * as _W from "wasmati";
import { p, q, b, beta, lambda, h } from "./bls12-377.params.js";
import { WasmArtifacts } from "../types.js";
import { createMsmField } from "../field-msm.js";
import { createCurveProjective } from "../curve-projective.js";
import { createCurveAffine } from "../curve-affine.js";
import { ThreadPool, setDebug } from "../threads/threads.js";
import {
  createRandomPointsFast,
  createRandomScalars,
} from "../curve-random.js";
import { GlvScalarParams, createGlvScalar } from "../scalar-glv.js";
import { randomGenerators } from "../field-util.js";

export { create };

const NAME = "BLS13-377";

let pool = ThreadPool.createInactive(import.meta.url);
pool.register(NAME, create);

async function create(
  wasm?: WasmArtifacts,
  scalarWasmParams?: { wasm: WasmArtifacts; fullParams: GlvScalarParams }
) {
  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField({ p, beta, w: 29 }, wasm);
  const Scalar = await createGlvScalar({ q, lambda, w: 29 }, scalarWasmParams);
  const CurveProjective = createCurveProjective(Field, h);
  const CurveAffine = createCurveAffine(Field, CurveProjective, b);
  const Inputs = { Field, Scalar, CurveAffine, CurveProjective };

  const randomPointsFast = pool.register(NAME, createRandomPointsFast(Inputs));
  const randomScalars = pool.register(NAME, createRandomScalars(Inputs));

  return {
    Field,
    Scalar,
    CurveAffine,
    randomPointsFast,
    randomScalars,

    async startThreads(n: number) {
      console.log(`starting ${n} workers`);
      await pool.start(n);
      Field.updateThreads();
      await pool.callWorkers(create, Field.wasmArtifacts, Scalar.wasmParams);
    },

    async stopThreads() {
      await pool.stop();
      Field.updateThreads();
    },
  };
}
