import { create } from "../src/concrete/pasta.parallel.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.js";
import assert from "node:assert/strict";
import { median, standardDev } from "./evaluate-util.js";

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

let doEvaluate = process.argv[5] === "--evaluate";

if (!doEvaluate) {
  tic(`msm (n=${n})`);
  console.log();
  let sPtr = await Pasta.msm(scalarPtrs[0], pointsPtrs[0], N, {
    verboseTiming: true,
  });
  let sAffinePtr = Pasta.Field.getPointer(Pasta.CurveAffine.sizeAffine);
  Pasta.CurveProjective.projectiveToAffine(scratch, sAffinePtr, sPtr);
  let s = Pasta.CurveAffine.toBigint(sAffinePtr);

  if (n < 10) {
    tic("msm (simple, slow bigint impl)");
    let sBigint = msmDumbAffine(scalars, points, Pasta.Scalar, Pasta.Field);
    toc();
    assert.deepEqual(s, sBigint, "consistent results");
    console.log("results are consistent!");
  }
  toc();
} else {
  let scalarPtr = scalarPtrs[0];
  let pointPtr = pointsPtrs[0];

  tic("warm-up JIT compiler with fixed set of points");
  await Pasta.msm(scalarPtr, pointPtr, 1 << 15);
  await new Promise((r) => setTimeout(r, 100));
  await Pasta.msm(scalarPtr, pointPtr, 1 << 15);
  await new Promise((r) => setTimeout(r, 100));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 10; i++) {
    let [scalarPtr] = await Pasta.randomScalars(N);
    tic();
    await Pasta.msm(scalarPtr, pointPtr, 1 << n);
    let time = toc();
    times.push(time);
  }
  tic("msm total");
  console.log();
  await Pasta.msm(scalarPtr, pointPtr, 1 << n, { verboseTiming: true });
  toc();

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.dir(
    { n, avg, std, times: times.map(Math.round) },
    { depth: Infinity }
  );
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);
}

await Pasta.stopThreads();
