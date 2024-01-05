import { create } from "../src/concrete/bls12-377.parallel.js";
import {
  CurveAffine,
  Field,
  Scalar,
  msm,
  msmUtil,
} from "../src/concrete/bls12-377.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import assert from "node:assert/strict";

const BLS12_377 = await create();

let n = Number(process.argv[3] ?? 16);
let N = 1 << n;

let nThreads = Number(process.argv[4] ?? 16);
await BLS12_377.startThreads(nThreads);

tic("random points");
let points = await BLS12_377.randomPointsFast(N);
toc();

tic("random scalars fast");
let scalarPtrs = await BLS12_377.randomScalars(N);
toc();

await BLS12_377.stopThreads();

tic("convert points to bigint & check");
let scratch = BLS12_377.Field.getPointers(5);
let pointsBigint = points.map((g) => {
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

tic("store points in main memory");
let size = N * CurveAffine.sizeAffine;
let sourcePtr = points[0];
let pointsPtr = Field.getPointer(size);
let sourceBytes = BLS12_377.Field.memoryBytes.subarray(
  sourcePtr,
  sourcePtr + size
);
Field.memoryBytes.set(sourceBytes, pointsPtr);
toc();

tic("store scalars in main memory");
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
toc();

tic("msm (core)");
let s0 = msm(scalarPtr, pointsPtr, N);
let scratch_ = Field.getPointers(40);
let s = msmUtil.toAffineOutputBigint(scratch_, s0);
toc();

if (n < 10) {
  tic("msm (simple, slow bigint impl)");
  let sBigint = msmDumbAffine(scalars, pointsBigint, Scalar, Field);
  toc();
  assert.deepEqual(s, sBigint, "consistent results");
  console.log("results are consistent!");
}
