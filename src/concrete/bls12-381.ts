import type * as W from "wasmati";
import { p, beta, q, lambda } from "./bls12-381.params.js";
import { createMsmField } from "../field-msm.js";
import { createGlvScalar, createSpecialGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";
import { randomGenerators } from "../bigint/field-random.js";
import { createBigintApi } from "../bigint.js";
import { createMsm } from "../msm.js";
import { createRandomPointsFast } from "../curve-random.js";

export { Bigint, Field, Scalar, Affine, Projective, Random, SpecialScalar };
export { msm, msmUnsafe, msmUtil };

const Field = await createMsmField({ p, beta, w: 30 });
const Scalar = await createGlvScalar({ q, lambda, w: 29 });
const Projective = createCurveProjective(Field);
const Affine = createCurveAffine(Field, Projective, 4n);

const SpecialScalar = await createSpecialGlvScalar(q, lambda, 29);

const MsmInputs = { Field, Scalar, Affine, Projective };

const { msm, msmUnsafe, msmBigint, ...msmUtil } = createMsm(MsmInputs);

let { randomField: randomScalar, randomFields: randomScalars } =
  randomGenerators(q);
const Random = {
  ...randomGenerators(p),
  randomScalar,
  randomScalars,
  randomPointsFast: createRandomPointsFast(MsmInputs),
};

const Bigint_ = createBigintApi({
  Field,
  Scalar,
  Affine: Affine,
  Projective: Projective,
});
const Bigint = {
  ...Bigint_,
  msm: msmBigint,
  randomFields: Random.randomFields,
  randomScalars,
};
