import { create } from "./concrete/pallas.parallel.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.web.js";
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
console.log();

tic(`msm (n=${n})`);
let { result, log } = await Pasta.msm(scalarPtrs[0], pointsPtrs[0], N, true);
let sAffinePtr = Pasta.Field.getPointer(Pasta.CurveAffine.size);
Pasta.CurveProjective.toAffine(scratch, sAffinePtr, result);
let s = Pasta.CurveAffine.toBigint(sAffinePtr);

log.forEach((l) => console.log(...l));
toc();

await Pasta.stopThreads();
