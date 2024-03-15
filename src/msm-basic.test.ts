import { msmBasic } from "./msm-basic.js";
import { msm as msmBigint } from "./bigint/msm.js";
import { curveParams } from "./concrete/ed-on-bls12-377.params.js";
import { createMsmField } from "./field-msm.js";
import { createCurveTwistedEdwards } from "./curve-twisted-edwards.js";
import { createCurveTwistedEdwards as createCurveBigint } from "./bigint/twisted-edwards.js";
import { createScalar } from "./scalar-simple.js";
import { createRandomPointsFast, createRandomScalars } from "./curve-random.js";
import { tic, toc } from "./testing/tictoc.js";
import { assert } from "./util.js";

const Field = await createMsmField({ p: curveParams.modulus, w: 29, beta: 1n });
const Scalar = await createScalar({ q: curveParams.order, w: 29 });
const Curve = createCurveTwistedEdwards(Field, curveParams);
const BigintCurve = createCurveBigint(curveParams);

let randomPoints = createRandomPointsFast({
  Field,
  Affine: Curve,
  Projective: Curve,
});
const randomScalars = createRandomScalars({ Scalar });

const n = 10;
const N = 1 << n;

// create random input points & scalars
tic("random inputs");
let points = await randomPoints(N);
let scalars = await randomScalars(N);
toc();

// run msm
tic("msm");
let result = await msmBasic({ Field, Scalar, Curve }, scalars, points, N);
let s0 = Curve.toBigint(result);
toc();

// convert points and scalars to bigints
tic("inputs to bigints");
let pointsBigint = points.map(Curve.toBigint);
let scalarsBigint = scalars.map(Scalar.toBigint);
toc();

// run bigint msm
tic("bigint msm");
let s1 = msmBigint(BigintCurve, scalarsBigint, pointsBigint);
toc();

assert(BigintCurve.isEqual(s0, s1), "msm result mismatch");
