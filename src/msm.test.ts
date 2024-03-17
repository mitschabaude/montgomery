/**
 * Test (multi-threaded) Wasm MSM for consistency against bigint implementation.
 *
 * This test currently doesn't use node:test so that we can run it in the browser.
 */
import {
  Weierstraß,
  TwistedEdwards,
  startThreads,
  stopThreads,
} from "./parallel.js";
import { msm as bigintMsm } from "./bigint/msm.js";
import { pallasParams } from "./concrete/pasta.params.js";
import { curveParams as bls12377Params } from "./concrete/bls12-377.params.js";
import { curveParams as bls12381Params } from "./concrete/bls12-381.params.js";
import { curveParams as edBls12Params } from "./concrete/ed-on-bls12-377.params.js";
import { assert } from "./util.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";
import { CurveParams as TwistedEdwardsParams } from "./bigint/twisted-edwards.js";
import { assertDeepEqual } from "./testing/nested.js";

let nThreads = 16;
await startThreads(nThreads);

// twisted edwards curves
await testMsmTE(edBls12Params);

// weierstrass curves with a=0 and endomorphism
await testMsm(pallasParams);
await testMsm(bls12377Params);
await testMsm(bls12381Params);

await stopThreads();

async function testMsm(curveParams: CurveParams) {
  console.log("testing msm", curveParams.label);
  const Curve = await Weierstraß.create(curveParams);

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
    assert(Affine.isOnCurve(scratch, g), "point not on curve");
    return Bigint.Projective.fromAffine(Affine.toBigint(g));
  });

  let scalars = scalarPtrs.map((s) => {
    let scalar = Scalar.readBigint(s);
    assert(scalar < Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);

  let { result } = await Parallel.msmUnsafe(scalarPtrs[0], pointsPtrs[0], N);
  let s = Projective.toBigint(result);

  let sBigint = bigintMsm(Bigint.Projective, scalars, points);

  assert(Bigint.Projective.isEqual(s, sBigint), `msm 2^${n} failed`);
}

async function testMsmTE(curveParams: TwistedEdwardsParams) {
  console.log("testing msm", curveParams.label);
  const Curve = await TwistedEdwards.create(curveParams);

  for (let n = 0; n < 14; n += 2) {
    await testOneMsmTE(Curve, n);
  }
}

async function testOneMsmTE(C: TwistedEdwards, n: number) {
  const { Field, Curve, Scalar, Parallel, Bigint } = C;
  let N = 1 << n;
  using _ = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(5);

  let pointsPtrs = await Parallel.randomPointsFast(N);
  let scalarPtrs = await Parallel.randomScalars(N);

  let points = pointsPtrs.map((g) => {
    assert(Curve.isOnCurve(scratch, g), "point not on curve");
    return Curve.toBigint(g);
  });

  let scalars = scalarPtrs.map((s) => {
    let scalar = Scalar.toBigint(s);
    assert(scalar < Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);

  let { result } = await Parallel.msm(scalarPtrs[0], pointsPtrs[0], N);
  let s = Bigint.toAffine(Curve.toBigint(result));
  let sBigint = Bigint.toAffine(bigintMsm(Bigint, scalars, points));
  assertDeepEqual(s, sBigint, `msm 2^${n} failed`);
}
