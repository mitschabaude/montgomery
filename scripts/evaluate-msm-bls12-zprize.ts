import { tic, toc } from "../src/extra/tictoc.js";
import { load } from "./store-inputs.js";
import { webcrypto } from "node:crypto";
import { msmAffine } from "../src/msm-bls12-zprize.js";
import { median, standardDev } from "./evaluate-util.js";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19)
  (globalThis as any).crypto = webcrypto;

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

let times: Record<number, { time: number; std: number }> = {};

for (let n of N) {
  let scalarsN = scalars.slice(0, 1 << n);
  let pointsN = points.slice(0, 1 << n);
  console.log({ n });
  let times_: number[] = [];
  for (let i = 0; i < REPEAT; i++) {
    tic();
    msmAffine(scalarsN, pointsN);
    let time = toc();
    times_.push(time);
  }
  let time = median(times_);
  let std = standardDev(times_);
  times[n] = { time, std };
}

console.dir(times, { depth: Infinity });
