import { Weierstraß, create } from "./module-weierstrass.js";
import { tic, toc } from "./extra/tictoc.web.js";
import { msm as bigintMsm } from "./bigint/msm.js";
import { pallasParams } from "./concrete/pasta.params.js";
import { curveParams as bls12377Params } from "./concrete/bls12-377.params.js";
import { assert } from "./util.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";

let nThreads = 16;

await testMsm(pallasParams);
await testMsm(bls12377Params);

async function testMsm(curveParams: CurveParams) {
  console.log("testing msm", curveParams.label);
  const Module = await create(curveParams);
  await Module.startThreads(nThreads);

  for (let n = 0; n < 14; n += 2) {
    await testOneMsm(Module, n);
  }

  await Module.stopThreads();
}

async function testOneMsm(Inputs: Weierstraß, n: number) {
  const { Field, CurveAffine, CurveProjective, Scalar, Parallel, Bigint } =
    Inputs;
  let N = 1 << n;
  const CurveBigint = Bigint.CurveProjective;
  using _ = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(5);

  let pointsPtrs = await Parallel.randomPointsFast(N);
  let scalarPtrs = await Parallel.randomScalars(N);

  let points = pointsPtrs.map((g) => {
    CurveAffine.assertOnCurve(scratch, g);
    return CurveBigint.fromAffine(CurveAffine.toBigint(g));
  });

  let scalars = scalarPtrs.map((s) => {
    let scalar = Scalar.readBigint(s);
    assert(scalar < Scalar.modulus);
    return scalar;
  });
  assert(scalars.length === N);

  tic(`msm (wasm)  `);
  let { result } = await Parallel.msmUnsafe(
    scalarPtrs[0],
    pointsPtrs[0],
    N,
    true
  );
  let s = CurveProjective.toBigint(result);
  toc();

  tic("msm (bigint)");
  let sBigint = bigintMsm(CurveBigint, scalars, points);
  toc();

  assert(CurveBigint.isEqual(s, sBigint));
  console.log(`msm 2^${n} ok`);
}
