import type * as _W from "wasmati";
import { p, q, b, beta, lambda, h } from "./bls12-377.params.js";
import { WasmArtifacts } from "../types.js";
import { createMsmField } from "../field-msm.js";
import { createCurveProjective } from "../curve-projective.js";
import { createCurveAffine } from "../curve-affine.js";
import { ThreadPool, setDebug } from "../threads/threads.js";
import { createRandomPointsFast } from "../curve-random-parallel.js";

export { create };

const NAME = "BLS13-377";

setDebug(true);

let pool = ThreadPool.createInactive(import.meta.url);
pool.register(NAME, create);

async function create(wasm?: WasmArtifacts) {
  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField({ p, beta, w: 29 }, wasm);
  const CurveProjective = createCurveProjective(Field, h);
  const CurveAffine = createCurveAffine(Field, CurveProjective, b);
  const Inputs = { Field, CurveAffine, CurveProjective };

  const randomPointsFast = pool.register(NAME, createRandomPointsFast(Inputs));

  return {
    Field,
    CurveAffine,
    randomPointsFast,

    async startThreads(n: number) {
      console.log(`starting ${n} workers`);
      await pool.start(n); // TODO timing bug, surfaces only if this await is added
      Field.updateThreads();
      await pool.callWorkers(create, Field.wasmArtifacts);
    },

    async stopThreads() {
      await pool.stop();
      Field.updateThreads();
    },
  };
}
