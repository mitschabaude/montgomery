import { curveParams } from "../src/concrete/bls12-377.params.js";
import {
  Weierstraß,
  startThreads,
  stopThreads,
} from "../src/module-weierstrass.js";
import { tic, toc } from "../src/testing/tictoc.js";
import { median, standardDev } from "./evaluate-util.js";

const { Parallel } = await Weierstraß.create(curveParams);

let n = Number(process.argv[3] ?? 16);

let warmup = 2;
let repeat = 5;

await evaluateParameters([n], [0, 1]);

async function evaluateParameters(N: number[], C: number[]) {
  let times: Record<number, Record<number, { time: number; std: number }>> = {}; // { n: { c: { time, std } } }
  let best: Record<number, { time: number; std?: number; c?: number }> = {}; // { n: { time, std, c } }

  await startThreads(16);

  for (let n of N) {
    times[n] = {};
    best[n] = { time: Infinity };
    let [points] = await Parallel.randomPointsFast(1 << n);

    for (let cDelta of C) {
      let c = n - 1 + cDelta;
      if (c < 1) continue;
      console.log({ n, c });

      let times_: number[] = [];
      for (let i = 0; i < warmup; i++) {
        let [scalars] = await Parallel.randomScalars(1 << n);
        let { log } = await Parallel.msmUnsafe(scalars, points, 1 << n, true, {
          c,
        });
        // for (let l of log) console.log(...l);
      }
      for (let i = 0; i < repeat; i++) {
        let [scalars] = await Parallel.randomScalars(1 << n);
        tic();
        try {
          await Parallel.msmUnsafe(scalars, points, 1 << n, false, { c });
          let time = toc();
          times_.push(time);
        } catch (e: any) {
          console.error(e);
        }
      }
      let time = median(times_);
      let std = standardDev(times_);
      times[n][c] = { time, std };
      console.dir({ n, c, time, std }, { depth: Infinity });
      if (time < best[n].time) best[n] = { time, std, c };
    }
    await stopThreads();

    console.dir({ times, best }, { depth: Infinity });
  }

  return { times, best };
}
