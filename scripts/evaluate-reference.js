import "../src/extra/fix-webcrypto.js";
import { tic, toc } from "../src/extra/tictoc.js";
import { load } from "./store-inputs.js";
import {
  ScalarVectorInput,
  PointVectorInput,
  compute_msm,
} from "../src/extra/reference.node.js";

tic("load inputs");
let { points, scalars } = await load(18);
toc();

tic("warm-up JIT compiler with fixed set of points");
{
  let scalarsN = scalars.slice(0, 1 << 14);
  let pointsN = points.slice(0, 1 << 14);
  let scalarVec = ScalarVectorInput.fromJsArray(scalarsN);
  let pointVec = PointVectorInput.fromJsArray(pointsN);
  compute_msm(pointVec, scalarVec);
  await new Promise((r) => setTimeout(r, 100));
  scalarVec = ScalarVectorInput.fromJsArray(scalarsN);
  pointVec = PointVectorInput.fromJsArray(pointsN);
  compute_msm(pointVec, scalarVec);
  await new Promise((r) => setTimeout(r, 100));
}
toc();

// how many timing samples to draw for each parameter
let REPEAT = 10;

// input log-sizes to test
let N = [14, 16, 18];

let times = {}; // { n: { time, std } }

for (let n of N) {
  let scalarsN = scalars.slice(0, 1 << n);
  let pointsN = points.slice(0, 1 << n);

  times[n] = {};

  console.log({ n });

  let times_ = [];
  for (let i = 0; i < REPEAT; i++) {
    let scalarVec = ScalarVectorInput.fromJsArray(scalarsN);
    let pointVec = PointVectorInput.fromJsArray(pointsN);
    tic();
    compute_msm(pointVec, scalarVec);
    let time = toc();
    times_.push(time);
  }
  let time = median(times_);
  let std = standardDev(times_);
  times[n] = { time, std };
}

console.dir(times, { depth: Infinity });

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
