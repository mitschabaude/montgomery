import "../src/extra/fix-webcrypto.js";
import { tic, toc } from "../src/extra/tictoc.js";
import { load } from "./store-inputs.js";
import { msmAffine } from "../src/msm-bls12-zprize.js";

tic("load inputs");
let { points, scalars } = await load(18);
toc();

tic("warm-up JIT compiler with fixed set of points");
{
  let scalarsN = scalars.slice(0, 1 << 14);
  let pointsN = points.slice(0, 1 << 14);
  msmAffine(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
  msmAffine(scalarsN, pointsN);
  await new Promise((r) => setTimeout(r, 100));
}
toc();

// how many timing samples to draw for each parameter
let REPEAT = 10;

// input log-sizes to test
let N = [14, 16, 18];

// window width's difference to n-1 to test
// n-1 is thought to be the optimal default
let C = [-3, -2, -1, 0];
// sub bucket log-size, diff to c >> 1 which is thought to be a good default
let C0 = [-1, 0, 1, 2, 3];

let times = {}; // { n: { c: { c0: { time, std } } } }
let best = {}; // { n: { time, std, c, c0 } }

for (let n of N) {
  let scalarsN = scalars.slice(0, 1 << n);
  let pointsN = points.slice(0, 1 << n);
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
      let times_ = [];
      for (let i = 0; i < REPEAT; i++) {
        tic();
        msmAffine(scalarsN, pointsN, { c, c0 });
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

function median(arr) {
  let mid = arr.length >> 1;
  let nums = [...arr].sort((a, b) => a - b);
  return arr.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}
function standardDev(arr) {
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
