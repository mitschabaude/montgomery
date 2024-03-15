import { TwistedEdwards } from "../src/module-twisted-edwards.js";
import { tic, toc } from "../src/testing/tictoc.js";
import { assert } from "../src/util.js";
import { median, standardDev } from "./evaluate-util.js";
import { msm as msmBigint } from "../src/bigint/msm.js";
import type { CurveParams } from "../src/bigint/twisted-edwards.js";

export { benchmarkMsm, runMsm };

async function benchmarkMsm(params: CurveParams, n: number, nThreads?: number) {
  let N = 1 << n;
  await TwistedEdwards.startThreads(nThreads);

  const { Parallel } = await TwistedEdwards.create(params);

  tic("random points");
  let points = await Parallel.randomPointsFast(N);
  toc();

  let scalars = await Parallel.randomScalars(N);
  tic("warm-up JIT compiler");
  await Parallel.msm(scalars[0], points[0], 1 << 15);
  await new Promise((r) => setTimeout(r, 50));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 15; i++) {
    let scalars = await Parallel.randomScalars(N);
    tic();
    await Parallel.msm(scalars[0], points[0], 1 << n);
    let time = toc();
    if (i > 4) times.push(time);
  }
  scalars = await Parallel.randomScalars(N);
  tic();
  let { log } = await Parallel.msm(scalars[0], points[0], 1 << n);
  let t = toc();

  log.forEach((l) => console.log(...l));
  console.log(`msm total... ${t.toFixed(1)}ms (incl. worker calling overhead)`);

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.log(times.map(Math.round));
  // console.dir({ n, avg, std, times: times.map(Math.round) });
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);

  await TwistedEdwards.stopThreads();
}

async function runMsm(params: CurveParams, n: number, nThreads?: number) {
  let N = 1 << n;
  const Curve = await TwistedEdwards.create(params);
  await TwistedEdwards.startThreads(nThreads);

  tic("random points");
  let pointsPtrs = await Curve.Parallel.randomPointsFast(N);
  toc();

  tic("random scalars");
  let scalarPtrs = await Curve.Parallel.randomScalars(N);
  toc();

  tic("check points");
  let scratch = Curve.Field.local.getPointers(10);
  pointsPtrs.forEach((g) => {
    assert(Curve.Curve.isOnCurve(scratch, g));
  });
  toc();

  tic("convert scalars to bigint & check");
  let scalars = scalarPtrs.map((s) => {
    let scalar = Curve.Scalar.toBigint(s);
    assert(scalar < Curve.Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);
  toc();
  console.log();

  tic(`msm (n=${n})`);
  let { result, log } = await Curve.Parallel.msm(
    scalarPtrs[0],
    pointsPtrs[0],
    N
  );
  let s = Curve.Curve.toBigint(result);

  log.forEach((l) => console.log(...l));
  toc();
  await TwistedEdwards.stopThreads();

  if (n < 14) {
    let points = pointsPtrs.map((g) => Curve.Curve.toBigint(g));
    tic("msm (bigint impl)");
    let sBigint = msmBigint(Curve.Bigint, scalars, points);
    toc();
    assert(Curve.Bigint.isEqual(s, sBigint), "consistent results");
    console.log("results are consistent!");
  }
}
