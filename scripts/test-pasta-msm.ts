import "../src/extra/fix-webcrypto.js";
import { tic, toc } from "../src/extra/tictoc.js";
import {
  msm,
  msmUtil,
  Field,
  CurveAffine,
  Random,
  Scalar,
  Bigint,
} from "../src/concrete/pasta.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import { checkOnCurve } from "../src/extra/dumb-curve-affine.js";
import { msm as bigintMsm } from "../src/bigint/msm.js";
import assert from "node:assert/strict";
import { createCurveProjective } from "../src/bigint/projective-weierstrass.js";
import { curveParams } from "../src/concrete/pasta.params.js";

let n = Number(process.argv[2] ?? 8);
let N = 1 << n;
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("random points");
let points = Field.getZeroPointers(N, CurveAffine.size);
let scratch = Field.getPointers(20);
CurveAffine.randomPoints(points);

let scalars = Random.randomScalars(N);
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
toc();

tic("convert points to bigint & check");
let pointsBigint = points.map((gPtr) => {
  let g = CurveAffine.toBigint(gPtr);
  assert(checkOnCurve(g, Field.p, CurveAffine.b), "point on curve");
  return g;
});
toc();

tic("msm (core)");
let s0 = msm(scalarPtr, points[0], N);
let s = msmUtil.toAffineOutputBigint(scratch, s0);
toc();

tic("msm (bigint)");
let s1 = Bigint.msm(scalars, pointsBigint);
toc();

assert.deepEqual(s, s1, "consistent with bigint version");

if (n < 12) {
  const PallasBigint = createCurveProjective(curveParams);
  tic("msm (bigint impl)");
  let sBigint = PallasBigint.toAffine(
    bigintMsm(PallasBigint, scalars, pointsBigint.map(PallasBigint.fromAffine))
  );
  toc();
  assert.deepEqual(s, sBigint, "consistent results");
  console.log("results are consistent!");
}
