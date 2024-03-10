import { MsmParams, create } from "../src/concrete/pallas.parallel.js";
import { tic, toc } from "../src/extra/tictoc.web.js";
import { assertDeepEqual } from "../src/testing/nested.js";
import { assert } from "../src/util.js";
import { median, standardDev } from "./evaluate-util.js";
import { createCurveProjective } from "../src/bigint/projective-weierstrass.js";
import { msm as bigintMsm } from "../src/bigint/msm.js";
import type { CurveParams } from "../src/bigint/affine-weierstrass.js";

export { benchmarkMsm, runMsm };

async function benchmarkMsm(
  n: number,
  nThreads: number | undefined,
  params: MsmParams
) {
  let N = 1 << n;

  const Msm = await create(params);
  await Msm.startThreads(nThreads);

  tic("random points");
  let [pointPtr] = await Msm.randomPointsFast(N);
  toc();

  let [scalarPtr] = await Msm.randomScalars(N);
  tic("warm-up JIT compiler");
  await Msm.msm(scalarPtr, pointPtr, 1 << 15, true);
  await new Promise((r) => setTimeout(r, 50));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 15; i++) {
    let [scalarPtr] = await Msm.randomScalars(N);
    tic();
    await Msm.msm(scalarPtr, pointPtr, 1 << n, true);
    let time = toc();
    if (i > 4) times.push(time);
  }
  [scalarPtr] = await Msm.randomScalars(N);
  tic();
  let { log } = await Msm.msm(scalarPtr, pointPtr, 1 << n, true);
  let t = toc();

  log.forEach((l) => console.log(...l));
  console.log(`msm total... ${t.toFixed(1)}ms (incl. worker calling overhead)`);

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.log(times.map(Math.round));
  // console.dir({ n, avg, std, times: times.map(Math.round) });
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);

  await Msm.stopThreads();
}

async function runMsm(
  n: number,
  nThreads: number | undefined,
  params: MsmParams,
  curveParams: CurveParams
) {
  let N = 1 << n;
  const Msm = await create(params);
  await Msm.startThreads(nThreads);

  tic("random points");
  let pointsPtrs = await Msm.randomPointsFast(N);
  toc();

  tic("random scalars");
  let scalarPtrs = await Msm.randomScalars(N);
  toc();

  tic("check points");
  let scratch = Msm.Field.local.getPointers(5);
  pointsPtrs.forEach((g) => {
    Msm.CurveAffine.assertOnCurve(scratch, g);
  });
  toc();

  tic("convert scalars to bigint & check");
  let scalars = scalarPtrs.map((s) => {
    let scalar = Msm.Scalar.readBigint(s);
    assert(scalar < Msm.Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);
  toc();
  console.log();

  tic(`msm (n=${n})`);
  let { result, log } = await Msm.msm(scalarPtrs[0], pointsPtrs[0], N, true);
  let sAffinePtr = Msm.Field.getPointer(Msm.CurveAffine.size);
  Msm.CurveProjective.toAffine(scratch, sAffinePtr, result);
  let s = Msm.CurveAffine.toBigint(sAffinePtr);

  log.forEach((l) => console.log(...l));
  toc();

  if (n < 14) {
    const CurveBigint = createCurveProjective(curveParams);
    let points = pointsPtrs.map((g) =>
      CurveBigint.fromAffine(Msm.CurveAffine.toBigint(g))
    );
    tic("msm (bigint impl)");
    let sBigint = CurveBigint.toAffine(bigintMsm(CurveBigint, scalars, points));
    toc();
    assertDeepEqual(s, sBigint, "consistent results");
    console.log("results are consistent!");
  }

  await Msm.stopThreads();
}
