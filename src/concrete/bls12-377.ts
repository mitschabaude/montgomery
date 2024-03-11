import type * as _W from "wasmati";
import { randomGenerators } from "../bigint/field-random.js";
import { p, q, b, beta, lambda, h } from "./bls12-377.params.js";
import { createMsmField } from "../field-msm.js";
import { createGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";
import { createMsm } from "../msm.js";
import { createBigintApi } from "../bigint.js";
import { createRandomPointsFast } from "../curve-random.js";

export {
  Bigint,
  Field,
  Scalar,
  Affine as CurveAffine,
  Projective as CurveProjective,
  Random,
};
export { msm, msmUnsafe, msmUtil };

const Field = await createMsmField({ p, beta, w: 29 });
const Scalar = await createGlvScalar({ q, lambda, w: 29 });
const Projective = createCurveProjective(Field, h);
const Affine = createCurveAffine(Field, Projective, b);

const MsmInputs = { Field, Scalar, Affine, Projective };

const { msm, msmUnsafe, msmBigint, ...msmUtil } = createMsm(MsmInputs);

const { randomField: randomScalar, randomFields: randomScalars } =
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
