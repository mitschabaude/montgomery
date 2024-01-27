import { create } from "../src/concrete/pasta.parallel.js";
import { msmDumbAffine } from "../src/extra/dumb-curve-affine.js";
import { tic, toc } from "../src/extra/tictoc.web.js";
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
console.log();

let doEvaluate = process.argv[5] === "--evaluate";

if (!doEvaluate) {
  tic(`msm (n=${n})`);
  let { result, log } = await Pasta.msm(scalarPtrs[0], pointsPtrs[0], N, true);
  let sAffinePtr = Pasta.Field.getPointer(Pasta.CurveAffine.size);
  Pasta.CurveProjective.toAffine(scratch, sAffinePtr, result);
  let s = Pasta.CurveAffine.toBigint(sAffinePtr);

  log.forEach((l) => console.log(...l));
  toc();

  if (n < 10) {
    tic("msm (simple, slow bigint impl)");
    let sBigint = msmDumbAffine(scalars, points, Pasta.Scalar, Pasta.Field);
    toc();
    assert.deepEqual(s, sBigint, "consistent results");
    console.log("results are consistent!");
  }
} else {
  let scalarPtr = scalarPtrs[0];
  let pointPtr = pointsPtrs[0];

  tic("warm-up JIT compiler");
  await Pasta.msm(scalarPtr, pointPtr, 1 << 15, true);
  await new Promise((r) => setTimeout(r, 50));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 15; i++) {
    let [scalarPtr] = await Pasta.randomScalars(N);
    tic();
    await Pasta.msm(scalarPtr, pointPtr, 1 << n, true);
    let time = toc();
    if (i > 4) times.push(time);
  }
  [scalarPtr] = await Pasta.randomScalars(N);
  tic();
  let { log } = await Pasta.msm(scalarPtr, pointPtr, 1 << n, true);
  let t = toc();

  log.forEach((l) => console.log(...l));
  console.log(`msm total... ${t.toFixed(1)}ms (incl. worker calling overhead)`);

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.log(times.map(Math.round));
  // console.dir({ n, avg, std, times: times.map(Math.round) });
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);
}

await Pasta.stopThreads();
