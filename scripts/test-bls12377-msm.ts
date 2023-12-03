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
} from "../src/concrete/bls12-377.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import { checkOnCurve, msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import assert from "node:assert/strict";

let n = Number(process.argv[2] ?? 8);
let N = 1 << n;
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("random points");
let points = Field.getZeroPointers(N, CurveAffine.sizeAffine);
let scratch = Field.getPointers(40);
CurveAffine.randomPoints(scratch, points);

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
  tic("msm (simple, slow bigint impl)");
  let sBigint = msmDumbAffine(scalars, pointsBigint, Scalar, Field);
  toc();
  assert.deepEqual(s, sBigint, "consistent results");
  console.log("results are consistent!");
}
