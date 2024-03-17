import {
  Weierstraß,
  startThreads,
  stopThreads,
} from "../src/module-weierstrass.js";
import { tic, toc } from "../src/testing/tictoc.js";
import { assertDeepEqual } from "../src/testing/nested.js";
import { assert } from "../src/util.js";
import { median, standardDev } from "./evaluate-util.js";
import { createCurveProjective } from "../src/bigint/projective-weierstrass.js";
import { msm as bigintMsm } from "../src/bigint/msm.js";
import type { CurveParams } from "../src/bigint/affine-weierstrass.js";

export { benchmarkMsm, runMsm };

async function benchmarkMsm(params: CurveParams, n: number, nThreads?: number) {
  let N = 1 << n;
  await startThreads(nThreads);

  const { Parallel } = await Weierstraß.create(params);

  tic("random points");
  let [pointPtr] = await Parallel.randomPointsFast(N);
  toc();

  let [scalarPtr] = await Parallel.randomScalars(N);
  tic("warm-up JIT compiler");
  await Parallel.msmUnsafe(scalarPtr, pointPtr, 1 << 15, true);
  await new Promise((r) => setTimeout(r, 50));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 15; i++) {
    let [scalarPtr] = await Parallel.randomScalars(N);
    tic();
    await Parallel.msmUnsafe(scalarPtr, pointPtr, 1 << n, true);
    let time = toc();
    if (i > 4) times.push(time);
  }
  [scalarPtr] = await Parallel.randomScalars(N);
  tic();
  let { log } = await Parallel.msmUnsafe(scalarPtr, pointPtr, 1 << n, true);
  let t = toc();

  log.forEach((l) => console.log(...l));
  console.log(`msm total... ${t.toFixed(1)}ms (incl. worker calling overhead)`);

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.log(times.map(Math.round));
  // console.dir({ n, avg, std, times: times.map(Math.round) });
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);

  await stopThreads();
}

async function runMsm(params: CurveParams, n: number, nThreads?: number) {
  let N = 1 << n;
  const Curve = await Weierstraß.create(params);
  await startThreads(nThreads);

  tic("random points");
  let pointsPtrs = await Curve.Parallel.randomPointsFast(N);
  toc();

  tic("random scalars");
  let scalarPtrs = await Curve.Parallel.randomScalars(N);
  toc();

  tic("check points");
  let scratch = Curve.Field.local.getPointers(5);
  pointsPtrs.forEach((g) => {
    Curve.Affine.assertOnCurve(scratch, g);
  });
  toc();

  tic("convert scalars to bigint & check");
  let scalars = scalarPtrs.map((s) => {
    let scalar = Curve.Scalar.readBigint(s);
    assert(scalar < Curve.Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);
  toc();
  console.log();

  tic(`msm (n=${n})`);
  let { result, log } = await Curve.Parallel.msmUnsafe(
    scalarPtrs[0],
    pointsPtrs[0],
    N,
    true
  );
  let sAffinePtr = Curve.Field.getPointer(Curve.Affine.size);
  Curve.Projective.toAffine(scratch, sAffinePtr, result);
  let s = Curve.Affine.toBigint(sAffinePtr);

  log.forEach((l) => console.log(...l));
  toc();

  if (n < 14) {
    const CurveBigint = createCurveProjective(params);
    let points = pointsPtrs.map((g) =>
      CurveBigint.fromAffine(Curve.Affine.toBigint(g))
    );
    tic("msm (bigint impl)");
    let sBigint = CurveBigint.toAffine(bigintMsm(CurveBigint, scalars, points));
    toc();
    assertDeepEqual(s, sBigint, "consistent results");
    console.log("results are consistent!");
  }

  await stopThreads();
}
