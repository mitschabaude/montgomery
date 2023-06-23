import { tic, toc } from "../src/extra/tictoc.js";
import type { BigintPoint } from "../src/msm.js";

export { evaluate, evaluateBigint, evaluateParameters, median, standardDev };

// how many timing samples to draw for each parameter
const REPEAT = 10;

function evaluate(
  msm: (scalarPtr: number, pointsPtr: number, N: number) => number,
  scalarPtr: number,
  pointPtr: number,
  N: number[]
) {
  let times: Record<number, { time: number; std: number }> = {};

  for (let n of N) {
    console.log({ n });
    let times_: number[] = [];
    for (let i = 0; i < REPEAT; i++) {
      tic();
      msm(scalarPtr, pointPtr, 1 << n);
      let time = toc();
      times_.push(time);
    }
    let time = median(times_);
    let std = standardDev(times_);
    times[n] = { time, std };
  }
  return times;
}

function evaluateBigint(
  msm: (scalar: bigint[], points: BigintPoint[]) => BigintPoint,
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

function evaluateParameters(
  msm: (
    scalarPtr: number,
    pointsPtr: number,
    N: number,
    options: {
      c?: number | undefined;
      c0?: number | undefined;
      useSafeAdditions?: boolean | undefined;
    }
  ) => number,
  scalarPtr: number,
  pointPtr: number,
  N: number[],
  C: number[],
  C0: number[]
) {
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
          msm(scalarPtr, pointPtr, 1 << n, { c, c0 });
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

  return { times, best };
}
