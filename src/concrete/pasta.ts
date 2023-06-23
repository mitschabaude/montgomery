import type * as W from "wasmati";
import { randomGenerators } from "../field-util.js";
import { p, q, beta, lambda } from "./pasta.params.js";
import { createMsmField } from "../field-msm.js";
import { createGeneralGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";
import { createMsm } from "../msm.js";

export { Field, Scalar, CurveAffine, CurveProjective, Random };
export { msm, msmBigint, msmBytesInput, msmUtil };

const Field = await createMsmField(p, beta, 30);
const Scalar = await createGeneralGlvScalar(q, lambda, 29);
const CurveAffine = createCurveAffine(Field, 5n);
const CurveProjective = createCurveProjective(Field);

const { msm, msmBigint, msmBytesInput, ...msmUtil } = createMsm({
  Field,
  Scalar,
  CurveAffine,
  CurveProjective,
});

const { randomField: randomScalar, randomFields: randomScalars } =
  randomGenerators(q);

const Random = { ...randomGenerators(p), randomScalar, randomScalars };
