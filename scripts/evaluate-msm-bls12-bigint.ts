import { tic, toc } from "../src/extra/tictoc.js";
import { load } from "./store-inputs.js";
import { webcrypto } from "node:crypto";
import { msmBigint } from "../src/msm-bls12-zprize.js";
import { bigintFromBytes } from "../src/util.js";
import { createMsm } from "../src/msm.js";
import {
  Field,
  GeneralScalar,
  CurveAffine,
  CurveProjective,
} from "../src/concrete/bls12-381.js";
import { evaluateBigint } from "./evaluate-util.js";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19)
  (globalThis as any).crypto = webcrypto;

// new impl
const { msmBigint: msmBigintNew } = createMsm({
  Field,
  Scalar: GeneralScalar,
  CurveAffine,
  CurveProjective,
});

tic("load inputs and convert to bigints");
let { points: pointsLoaded, scalars: scalarsLoaded } = await load(18);
let points = pointsLoaded.map((P) => {
  let x = bigintFromBytes(P[0]);
  let y = bigintFromBytes(P[1]);
  let isInfinity = P[2];
  return { x, y, isInfinity };
});
let scalars = scalarsLoaded.map((s) => bigintFromBytes(s));
toc();

tic("warm-up JIT compiler with fixed set of points");
{
  let scalarsN = scalars.slice(0, 1 << 14);
  let pointsN = points.slice(0, 1 << 14);
  msmBigint(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
  msmBigint(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
  msmBigintNew(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
  msmBigintNew(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
}
toc();

// input log-sizes to test
const N = [14, 16, 18];

console.log("msm zprize");
let times = evaluateBigint(msmBigint, scalars, points, N);
console.dir(times, { depth: Infinity });

console.log("msm general");
let timesNew = evaluateBigint(msmBigintNew, scalars, points, N);
console.dir(timesNew, { depth: Infinity });
