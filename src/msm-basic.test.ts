import { msm as msmBigint } from "./bigint/msm.js";
import { curveParams } from "./concrete/ed-on-bls12-377.params.js";
import { tic, toc } from "./testing/tictoc.js";
import { assert } from "./util.js";
import { create, startThreads, stopThreads } from "./module-twisted-edwards.js";

const Curve = await create(curveParams);

const n = 12;
const N = 1 << n;

await startThreads();

// create random input points & scalars
tic("random inputs");
let points = await Curve.Parallel.randomPointsFast(N);
let scalars = await Curve.Parallel.randomScalars(N);
toc();

// run msm
tic("msm");
let result = await Curve.Parallel.msm(scalars, points, N);
let s0 = Curve.Curve.toBigint(result);
toc();

await stopThreads();

if (n < 15) {
  // convert points and scalars to bigints
  tic("inputs to bigints");
  let pointsBigint = points.map(Curve.Curve.toBigint);
  let scalarsBigint = scalars.map(Curve.Scalar.toBigint);
  toc();

  // run bigint msm
  tic("bigint msm");
  let s1 = msmBigint(Curve.Bigint, scalarsBigint, pointsBigint);
  toc();

  assert(Curve.Bigint.isEqual(s0, s1), "msm result mismatch");
  assert(Curve.Bigint.isZero(s1) === false, "msm result is zero");
}
