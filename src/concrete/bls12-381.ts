import type * as W from "wasmati";
import { p, beta, q, lambda } from "./bls12-381.params.js";
import { createMsmField } from "../field-msm.js";
import { createGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";
import { randomGenerators } from "../field-util.js";

export { Field, Scalar, CurveAffine, CurveProjective, Random };

const Field = await createMsmField(p, beta, 30);
const Scalar = await createGlvScalar(q, lambda, 29);
const CurveAffine = createCurveAffine(Field, 4n);
const CurveProjective = createCurveProjective(Field);

let { randomField: randomScalar, randomFields: randomScalars } =
  randomGenerators(q);
const Random = { ...randomGenerators(p), randomScalar, randomScalars };
