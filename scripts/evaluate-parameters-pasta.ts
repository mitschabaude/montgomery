// TODO get this to run by fixing memory leaks in base msm

import { tic, toc } from "../src/extra/tictoc.js";
import { Field, CurveAffine, Random } from "../src/concrete/pasta.js";
import { msm, bigintScalarsToMemory } from "../src/msm-pasta.js";
import { webcrypto } from "node:crypto";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19) {
  globalThis.crypto = webcrypto as any;
}

let Nmax = 1 << 18;

tic("random points");
let points = Field.getZeroPointers(Nmax, CurveAffine.sizeAffine);
let scratch = Field.getPointers(20);
CurveAffine.randomCurvePoints(scratch, points);
let scalars = Random.randomScalars(Nmax);
let scalarPtr = bigintScalarsToMemory(scalars);
toc();

tic("warm-up JIT compiler with fixed set of points");
msm(scalarPtr, points[0], 1 << 14);
toc();

// how many timing samples to draw for each parameter
let REPEAT = 10;

// input log-sizes to test
let N = [14, 16, 18];

// window width's difference to n-1 to test
// n-1 is thought to be the optimal default
let C = [-2, -1, 0, 1];
// sub bucket log-size, diff to c >> 1 which is thought to be a good default
let C0 = [-1, 0, 1, 2];

let times: Record<
  number,
  Record<number, Record<number, { time: number; std: number }>>
> = {}; // { n: { c: { c0: { time, std } } } }
let best: Record<
  number,
  { time: number; std?: number; c?: number; c0?: number }
> = {}; // { n: { time, std, c, c0 } }

for (let n of N) {
  times[n] = {};
  best[n] = { time: Infinity };

  for (let cDelta of C) {
    let c = n - 1 + cDelta;
    if (c < 1) continue;
    times[n][c] = {};
    console.log({ n, c });

    for (let c0Delta of C0) {
      let c0 = (c >> 1) + c0Delta;
      if (c0 < 1 || c0 > c - 1) continue;
      let times_: number[] = [];
      for (let i = 0; i < REPEAT; i++) {
        tic();
        msm(scalarPtr, points[0], 1 << n, { c, c0 });
        let time = toc();
        times_.push(time);
      }
      let time = median(times_);
      let std = standardDev(times_);
      times[n][c][c0] = { time, std };
      if (time < best[n].time) best[n] = { time, std, c, c0 };
    }
  }
  console.dir({ times, best }, { depth: Infinity });
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
