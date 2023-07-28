import type * as W from "wasmati";
import { p, beta, q, lambda } from "./bls12-381.params.js";
import { createMsmField } from "../field-msm.js";
import { createGeneralGlvScalar, createGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";
import { randomGenerators } from "../field-util.js";
import { createBigintApi } from "../bigint.js";
import { createMsm } from "../msm.js";

export {
  Bigint,
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
  Random,
  SpecialScalar,
};
export { msm, msmUnsafe, msmUtil };

const Field = await createMsmField(p, beta, 30);
const Scalar = await createGeneralGlvScalar(q, lambda, 29);
const CurveAffine = createCurveAffine(Field, 4n);
const CurveProjective = createCurveProjective(Field);

const SpecialScalar = await createGlvScalar(q, lambda, 29);

const { msm, msmUnsafe, msmBigint, ...msmUtil } = createMsm({
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
});

let { randomField: randomScalar, randomFields: randomScalars } =
  randomGenerators(q);
const Random = { ...randomGenerators(p), randomScalar, randomScalars };

const Bigint_ = createBigintApi({
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
});
const Bigint = {
  ...Bigint_,
  msm: msmBigint,
  randomFields: Random.randomFields,
  randomScalars,
};
