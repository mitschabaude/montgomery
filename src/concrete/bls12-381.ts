import type * as W from "wasmati";
import { p, beta, q, lambda } from "./bls12-381.params.js";
import { createMsmField } from "../field-msm.js";
import { createGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";

export { Field, Scalar, CurveAffine, CurveProjective };

const Field = await createMsmField(p, beta, 30);
const Scalar = await createGlvScalar(q, lambda, 29);
const CurveAffine = createCurveAffine(Field);
const CurveProjective = createCurveProjective(Field);
