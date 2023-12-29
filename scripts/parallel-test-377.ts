import { create } from "../src/concrete/bls12-377.parallel.js";
import {
  CurveAffine,
  Field,
  Random,
  Scalar,
  msm,
  msmUtil,
} from "../src/concrete/bls12-377.js";
import { checkOnCurve, msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
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

await BLS12_377.stopThreads();

tic("convert points to bigint & check");
let scratch = BLS12_377.Field.getPointers(5);
let pointsBigint = points.map((gPtr) => {
  BLS12_377.CurveAffine.assertOnCurve(scratch, gPtr);
  return BLS12_377.CurveAffine.toBigint(gPtr);
});
toc();

tic("store points in main memory");
let size = N * CurveAffine.sizeAffine;
let sourcePtr = points[0];
let targetPtr = Field.getPointer(size);
let sourceBytes = BLS12_377.Field.memoryBytes.subarray(
  sourcePtr,
  sourcePtr + size
);
Field.memoryBytes.set(sourceBytes, targetPtr);
toc();

tic("random scalars");
let scalars = Random.randomScalars(N);
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
toc();

tic("msm (core)");
let s0 = msm(scalarPtr, points[0], N);
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
