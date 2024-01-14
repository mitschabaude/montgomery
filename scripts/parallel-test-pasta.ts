import { create } from "../src/concrete/pasta.parallel.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.js";
import assert from "node:assert/strict";

const Pasta = await create();

let n = Number(process.argv[3] ?? 16);
let N = 1 << n;

let nThreads = Number(process.argv[4] ?? 16);
await Pasta.startThreads(nThreads);

tic("random points");
let pointsPtrs = await Pasta.randomPointsFast(N);
toc();

tic("random scalars");
let scalarPtrs = await Pasta.randomScalars(N);
toc();

tic("convert points to bigint & check");
let scratch = Pasta.Field.local.getPointers(5);
let points = pointsPtrs.map((g) => {
  Pasta.CurveAffine.assertOnCurve(scratch, g);
  return Pasta.CurveAffine.toBigint(g);
});
toc();

tic("convert scalars to bigint & check");
let scalars = scalarPtrs.map((s) => {
  let scalar = Pasta.Scalar.readBigint(s);
  assert(scalar < Pasta.Scalar.modulus);
  return scalar;
});
assert(scalars.length === N);
toc();

tic("msm (core)");
console.log();
let sPtr = await Pasta.msm(scalarPtrs[0], pointsPtrs[0], N);
let sAffinePtr = Pasta.Field.getPointer(Pasta.CurveAffine.sizeAffine);
Pasta.CurveProjective.projectiveToAffine(scratch, sAffinePtr, sPtr);
let s = Pasta.CurveAffine.toBigint(sAffinePtr);
toc();

await Pasta.stopThreads();

if (n < 10) {
  tic("msm (simple, slow bigint impl)");
  let sBigint = msmDumbAffine(scalars, points, Pasta.Scalar, Pasta.Field);
  toc();
  assert.deepEqual(s, sBigint, "consistent results");
  console.log("results are consistent!");
}
