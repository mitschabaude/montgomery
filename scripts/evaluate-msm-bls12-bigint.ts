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

// how many timing samples to draw for each parameter
let REPEAT = 10;

// input log-sizes to test
const N = [14, 16, 18];

console.log("msm zprize");
let times = evaluate(msmBigint, N);
console.dir(times, { depth: Infinity });

console.log("msm general");
let timesNew = evaluate(msmBigintNew, N);
console.dir(timesNew, { depth: Infinity });

function evaluate(msm: typeof msmBigint, N: number[]) {
  let times: Record<number, { time: number; std: number }> = {};

  for (let n of N) {
    let scalarsN = scalars.slice(0, 1 << n);
    let pointsN = points.slice(0, 1 << n);
    console.log({ n });
    let times_: number[] = [];
    for (let i = 0; i < REPEAT; i++) {
      tic();
      msm(scalarsN, pointsN);
      let time = toc();
      times_.push(time);
    }
    let time = median(times_);
    let std = standardDev(times_);
    times[n] = { time, std };
  }

  return times;
}

function median(arr: number[]) {
  let mid = arr.length >> 1;
  let nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function standardDev(arr: number[]) {
  let n = arr.length;
  let sum = 0;
  for (let x of arr) {
    sum += x;
  }
  let mean = sum / n;
  let sumSqrDiffs = 0;
  for (let x of arr) {
    sumSqrDiffs += (x - mean) ** 2;
  }
  return Math.sqrt(sumSqrDiffs / (n - 1));
}
