import type * as _W from "wasmati";
import { p, q, b, beta, lambda, h } from "./bls12-377.params.js";
import { WasmArtifacts } from "../types.js";
import { createMsmField } from "../field-msm.js";
import { createCurveProjective } from "../curve-projective.js";
import { createCurveAffine } from "../curve-affine.js";
import { ThreadPool, barrier, setDebug } from "../threads/threads.js";
import { createRandomPointsFast } from "../curve-random-parallel.js";

export { create };

setDebug(false);

const NAME = "BLS13-377";

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
    randomPointsFast,

    async startThreads(n: number) {
      console.log(`starting ${n} workers`);
      pool.start(n);
      Field.updateThreads();
      await pool.callWorkers(create, Field.wasmArtifacts);
      // so that main thread doesn't start with an advantage, which would distort benchmarks
      await barrier();
    },
    async stopThreads() {
      await pool.stop();
    },
  };
}
