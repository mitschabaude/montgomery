/**
 * Test (multi-threaded) Wasm MSM for consistency against bigint implementation.
 *
 * This test currently doesn't use node:test so that we can run it in the browser.
 */
import {
  Weierstraß,
  create,
  startThreads,
  stopThreads,
} from "./module-weierstrass.js";
import { tic, toc } from "./extra/tictoc.web.js";
import { msm as bigintMsm } from "./bigint/msm.js";
import { pallasParams } from "./concrete/pasta.params.js";
import { curveParams as bls12377Params } from "./concrete/bls12-377.params.js";
import { assert } from "./util.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";

let nThreads = 16;

// weierstrass curves with a=0 and endomorphism
// TODO we currently can't use a different worker module within this same test,
// because they all use the same global pool and overwrite its worker entrypoint file
await startThreads(nThreads);
await testMsm(pallasParams);
await testMsm(bls12377Params);
await stopThreads();

async function testMsm(curveParams: CurveParams) {
  console.log("testing msm", curveParams.label);
  const Curve = await create(curveParams);

  for (let n = 0; n < 14; n += 2) {
    await testOneMsm(Curve, n);
  }
}

async function testOneMsm(Curve: Weierstraß, n: number) {
  const { Field, Affine, Projective, Scalar, Parallel, Bigint } = Curve;
  let N = 1 << n;
  using _ = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(5);

  let pointsPtrs = await Parallel.randomPointsFast(N);
  let scalarPtrs = await Parallel.randomScalars(N);

  let points = pointsPtrs.map((g) => {
    Affine.assertOnCurve(scratch, g);
    return Bigint.Projective.fromAffine(Affine.toBigint(g));
  });

  let scalars = scalarPtrs.map((s) => {
    let scalar = Scalar.readBigint(s);
    assert(scalar < Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);

  tic(`msm (wasm)  `);
  let { result } = await Parallel.msmUnsafe(scalarPtrs[0], pointsPtrs[0], N);
  let s = Projective.toBigint(result);
  toc();

  tic("msm (bigint)");
  let sBigint = bigintMsm(Bigint.Projective, scalars, points);
  toc();

  assert(Bigint.Projective.isEqual(s, sBigint));
  console.log(`msm 2^${n} ok`);
}
