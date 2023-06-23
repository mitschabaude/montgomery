import { tic, toc } from "../src/extra/tictoc.js";
import type { BigintPoint } from "../src/msm.js";

export { evaluate, median, standardDev };

// how many timing samples to draw for each parameter
const REPEAT = 10;

function evaluate(
  msm: (scalars: bigint[], points: BigintPoint[]) => BigintPoint,
  scalars: bigint[],
  points: BigintPoint[],
  N: number[]
) {
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
