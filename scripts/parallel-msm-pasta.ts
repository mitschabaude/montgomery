import { create } from "../src/concrete/pallas.parallel.js";
import { tic, toc } from "../src/extra/tictoc.web.js";
import { assert } from "../src/util.js";
import { median, standardDev } from "./evaluate-util.js";
import { msm as bigintMsm } from "../src/bigint/msm.js";
import { curveParams } from "../src/concrete/pasta.params.js";
import { createCurveProjective } from "../src/bigint/projective-weierstrass.js";
import { assertDeepEqual } from "../src/testing/nested.js";

const Pallas = await create();

let n = Number(process.argv[3] ?? 16);
let N = 1 << n;

let nThreads = Number(process.argv[4] ?? 16);
await Pallas.startThreads(nThreads);

tic("random points");
let pointsPtrs = await Pallas.randomPointsFast(N);
toc();

tic("random scalars");
let scalarPtrs = await Pallas.randomScalars(N);
toc();

tic("check points");
let scratch = Pallas.Field.local.getPointers(5);
pointsPtrs.forEach((g) => {
  Pallas.CurveAffine.assertOnCurve(scratch, g);
});
toc();

tic("convert scalars to bigint & check");
let scalars = scalarPtrs.map((s) => {
  let scalar = Pallas.Scalar.readBigint(s);
  assert(scalar < Pallas.Scalar.modulus);
  return scalar;
});
assert(scalars.length === N);
toc();
console.log();

let doEvaluate = process.argv[5] === "--evaluate";

if (!doEvaluate) {
  tic(`msm (n=${n})`);
  let { result, log } = await Pallas.msm(scalarPtrs[0], pointsPtrs[0], N, true);
  let sAffinePtr = Pallas.Field.getPointer(Pallas.CurveAffine.size);
  Pallas.CurveProjective.toAffine(scratch, sAffinePtr, result);
  let s = Pallas.CurveAffine.toBigint(sAffinePtr);

  log.forEach((l) => console.log(...l));
  toc();

  if (n < 14) {
    const PallasBigint = createCurveProjective(curveParams);
    let points = pointsPtrs.map((g) =>
      PallasBigint.fromAffine(Pallas.CurveAffine.toBigint(g))
    );
    tic("msm (bigint impl)");
    let sBigint = PallasBigint.toAffine(
      bigintMsm(PallasBigint, scalars, points)
    );
    toc();
    assertDeepEqual(s, sBigint, "consistent results");
    console.log("results are consistent!");
  }
} else {
  let scalarPtr = scalarPtrs[0];
  let pointPtr = pointsPtrs[0];

  tic("warm-up JIT compiler");
  await Pallas.msm(scalarPtr, pointPtr, 1 << 15, true);
  await new Promise((r) => setTimeout(r, 50));
  toc();

  let times: number[] = [];
  for (let i = 0; i < 15; i++) {
    let [scalarPtr] = await Pallas.randomScalars(N);
    tic();
    await Pallas.msm(scalarPtr, pointPtr, 1 << n, true);
    let time = toc();
    if (i > 4) times.push(time);
  }
  [scalarPtr] = await Pallas.randomScalars(N);
  tic();
  let { log } = await Pallas.msm(scalarPtr, pointPtr, 1 << n, true);
  let t = toc();

  log.forEach((l) => console.log(...l));
  console.log(`msm total... ${t.toFixed(1)}ms (incl. worker calling overhead)`);

  let avg = Math.round(median(times));
  let std = Math.round(standardDev(times));
  console.log(times.map(Math.round));
  // console.dir({ n, avg, std, times: times.map(Math.round) });
  console.log(`msm (n=${n})... ${avg}ms ± ${std}ms`);
}

await Pallas.stopThreads();
