import { create } from "../src/concrete/bls12-377.parallel.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.js";
import assert from "node:assert/strict";

const BLS12_377 = await create();

let n = Number(process.argv[3] ?? 16);
let N = 1 << n;

let nThreads = Number(process.argv[4] ?? 16);
await BLS12_377.startThreads(nThreads);

tic("random points");
let pointsPtrs = await BLS12_377.randomPointsFast(N);
toc();

tic("random scalars");
let scalarPtrs = await BLS12_377.randomScalars(N);
toc();

tic("convert points to bigint & check");
let scratch = BLS12_377.Field.local.getPointers(5);
let points = pointsPtrs.map((g) => {
  BLS12_377.CurveAffine.assertOnCurve(scratch, g);
  return BLS12_377.CurveAffine.toBigint(g);
});
toc();

tic("convert scalars to bigint & check");
let scalars = scalarPtrs.map((s) => {
  let scalar = BLS12_377.Scalar.readBigint(s);
  assert(scalar < BLS12_377.Scalar.modulus);
  return scalar;
});
assert(scalars.length === N);
toc();

tic("msm (core)");
console.log();
let { result, log } = await BLS12_377.msm(scalarPtrs[0], pointsPtrs[0], N);
let sAffinePtr = BLS12_377.Field.getPointer(BLS12_377.CurveAffine.size);
BLS12_377.CurveProjective.projectiveToAffine(scratch, sAffinePtr, result);
let s = BLS12_377.CurveAffine.toBigint(sAffinePtr);
toc();

log.forEach((l) => console.log(...l));

await BLS12_377.stopThreads();

if (n < 10) {
  tic("msm (simple, slow bigint impl)");
  let sBigint = msmDumbAffine(
    scalars,
    points,
    BLS12_377.Scalar,
    BLS12_377.Field
  );
  toc();
  assert.deepEqual(s, sBigint, "consistent results");
  console.log("results are consistent!");
}
