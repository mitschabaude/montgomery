import { create } from "./concrete/pallas.parallel.js";
import { tic, toc } from "./extra/tictoc.web.js";
import { msm as bigintMsm } from "./bigint/msm.js";
import { curveParams as pallasParams } from "./concrete/pasta.params.js";
import { createCurveProjective } from "./bigint/projective-weierstrass.js";
import assert from "node:assert/strict";

const Pallas = await create();
const PallasBigint = createCurveProjective(pallasParams);

let nThreads = 16;

await Pallas.startThreads(nThreads);
let scratch = Pallas.Field.local.getPointers(5);

for (let n = 0; n < 14; n += 2) {
  await testMsm(n);
}

await Pallas.stopThreads();

async function testMsm(n: number) {
  let N = 1 << n;

  let pointsPtrs = await Pallas.randomPointsFast(N);
  let scalarPtrs = await Pallas.randomScalars(N);

  let points = pointsPtrs.map((g) => {
    Pallas.CurveAffine.assertOnCurve(scratch, g);
    return PallasBigint.fromAffine(Pallas.CurveAffine.toBigint(g));
  });

  let scalars = scalarPtrs.map((s) => {
    let scalar = Pallas.Scalar.readBigint(s);
    assert(scalar < Pallas.Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);

  tic(`msm (wasm)  `);
  let { result } = await Pallas.msm(scalarPtrs[0], pointsPtrs[0], N, true);
  let s = Pallas.CurveProjective.toBigint(result);
  toc();

  tic("msm (bigint)");
  let sBigint = bigintMsm(PallasBigint, scalars, points);
  toc();

  assert(PallasBigint.isEqual(s, sBigint));
  console.log(`msm 2^${n} ok`);
}
