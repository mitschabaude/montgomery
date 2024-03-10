import type * as _W from "wasmati";
import { WasmArtifacts } from "./types.js";
import { createMsmField } from "./field-msm.js";
import { createCurveProjective } from "./curve-projective.js";
import { createCurveAffine } from "./curve-affine.js";
import { createRandomPointsFast, createRandomScalars } from "./curve-random.js";
import { GlvScalarParams, createGlvScalar } from "./scalar-glv.js";
import { createMsm } from "./msm-parallel.js";
import { pool } from "./threads/global-pool.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";
import { assert } from "./util.js";

export { create };

INLINE_URL: pool.setSource(import.meta.url);
pool.register("Weierstraß", create);

async function create(
  params: CurveParams,
  wasm?: WasmArtifacts,
  scalarWasmParams?: { wasm: WasmArtifacts; fullParams: GlvScalarParams }
) {
  let { modulus: p, order: q, endomorphism, a, b, label } = params;
  assert(a === 0n, "only curves with a = 0 are supported");
  assert(endomorphism !== undefined, "endomorphism required");
  let { beta, lambda } = endomorphism;

  // create modules
  // note: if wasm is not provided, it will be created
  // so workers have to be called with the wasm from the main thread
  const Field = await createMsmField({ p, beta, w: 29 }, wasm);
  const Scalar = await createGlvScalar({ q, lambda, w: 29 }, scalarWasmParams);
  const CurveProjective = createCurveProjective(Field);
  const CurveAffine = createCurveAffine(Field, CurveProjective, b);
  const Inputs = { Field, Scalar, CurveAffine, CurveProjective };

  const randomPointsFast = createRandomPointsFast(Inputs);
  const randomScalars = createRandomScalars(Inputs);
  const MSM = createMsm(Inputs);
  const Parallel = pool.register(`Weierstraß-${label}`, {
    randomPointsFast,
    randomScalars,
    msmUnsafe: MSM.msmUnsafe,
    msm: MSM.msm,
  });

  return {
    Field,
    Scalar,
    CurveAffine,
    CurveProjective,
    Parallel,

    async startThreads(n?: number) {
      await pool.start(n);
      Field.updateThreads();
      await pool.callWorkers(
        create,
        params,
        Field.wasmArtifacts,
        Scalar.wasmParams
      );
    },

    async stopThreads() {
      await pool.stop();
      Field.updateThreads();
    },
  };
}
