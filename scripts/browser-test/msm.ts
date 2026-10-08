/**
 * Multithreaded MSMs, which ./run.ts runs in a browser
 */
import {
  CurveParams,
  TwistedEdwardsParams,
  Weierstraß,
  startThreads,
  stopThreads,
} from "../../src/index.ts";
import { runMsm } from "../msm-weierstrass.ts";
import { runMsm as runMsmTwistedEdwards } from "../msm-twisted-edwards.ts";
import { assertDeepEqual } from "../../src/testing/nested.ts";

const n = 12;
const nThreads = 4;

// curves created before the workers start, which get sent to workers on start
await runMsm(CurveParams.pallas, n, nThreads, { backend: "29-bit" });
await runMsm(CurveParams.pallas, n, nThreads);
await runMsmTwistedEdwards(TwistedEdwardsParams.ed377, n, nThreads);

// a curve created while the workers are running, which gets sent right away
await startThreads(nThreads);
let Curve = await Weierstraß.create(CurveParams.bls12377);
let N = 1 << n;
let pointPtrs = await Curve.Parallel.randomPointsFast(N);
let scalarPtrs = await Curve.Parallel.randomScalars(N);
let { result } = await Curve.Parallel.msm(scalarPtrs[0], pointPtrs[0], N);
await stopThreads();

let { Scalar, Affine, Bigint } = Curve;
let scalars = scalarPtrs.map((s) => Scalar.readBigint(s));
let points = pointPtrs.map((g) =>
  Bigint.Projective.fromAffine(Affine.toBigint(g)),
);
let expected = Bigint.Projective.toAffine(
  Bigint.Projective.msm(scalars, points),
);
assertDeepEqual(Affine.toBigint(result), expected, "consistent results");
console.log(`${Curve.params.label}: results are consistent!`);

(globalThis as any).browserTestDone = true;
