import { randomGenerators } from "../field-util.js";
import { p, q, beta, lambda } from "./pasta.params.js";
import { createMsmField } from "../field-msm.js";
import { createGeneralGlvScalar } from "../scalar-glv.js";
import { createCurveAffine } from "../curve-affine.js";
import { createCurveProjective } from "../curve-projective.js";

export { Field, Scalar, CurveAffine, CurveProjective, Random };

const Field = await createMsmField(p, beta, 30);
const Scalar = await createGeneralGlvScalar(q, lambda, 29);
const CurveAffine = createCurveAffine(Field, 5n);
const CurveProjective = createCurveProjective(Field);

const { randomField: randomScalar, randomFields: randomScalars } =
  randomGenerators(q);

const Random = { ...randomGenerators(p), randomScalar, randomScalars };
