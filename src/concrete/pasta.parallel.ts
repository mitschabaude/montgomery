import type * as _W from "wasmati";
import { p, q, b, beta, lambda } from "./pasta.params.js";
import { WasmArtifacts } from "../types.js";
import { createMsmField } from "../field-msm.js";
import { createCurveProjective } from "../curve-projective.js";
import { createCurveAffine } from "../curve-affine.js";
import {
  createRandomPointsFast,
  createRandomScalars,
} from "../curve-random.js";
import { GlvScalarParams, createGlvScalar } from "../scalar-glv.js";
import { createMsm } from "../msm-parallel.js";
import { pool } from "../threads/global-pool.js";

export { create };

const NAME = "Pasta";

pool.setSource(import.meta.url);
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
  const CurveProjective = createCurveProjective(Field);
  const CurveAffine = createCurveAffine(Field, CurveProjective, b);
  const Inputs = { Field, Scalar, CurveAffine, CurveProjective };

  const randomPointsFast = pool.register(NAME, createRandomPointsFast(Inputs));
  const randomScalars = pool.register(NAME, createRandomScalars(Inputs));

  const { msmUnsafe } = createMsm(Inputs);
  const msm = pool.register(NAME, msmUnsafe);

  return {
    Field,
    Scalar,
    CurveAffine,
    CurveProjective,

    randomPointsFast,
    randomScalars,

    msm,

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
