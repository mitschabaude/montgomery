import { msmBasic } from "./msm-basic.js";
import { curveParams } from "./concrete/ed-on-bls12-377.params.js";
import { createMsmField } from "./field-msm.js";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.js";
import { createScalar } from "./scalar-simple.js";
import { createRandomPointsFast, createRandomScalars } from "./curve-random.js";

const Field = await createMsmField({ p: curveParams.modulus, w: 29, beta: 1n });
const Scalar = await createScalar({ q: curveParams.order, w: 29 });
const Curve = createCurveTwistedEdwards(Field, curveParams);

let randomPoints = createRandomPointsFast({
  Field,
  Affine: Curve,
  Projective: Curve,
});
const randomScalars = createRandomScalars({ Scalar });

const n = 10;
const N = 1 << n;

// create random input points & scalars
let [points] = await randomPoints(N);
let [scalars] = await randomScalars(N);

await msmBasic({ Field, Scalar, Curve }, scalars, points, N);
