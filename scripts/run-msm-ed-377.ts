import { TwistedEdwardsParams } from "../src/index.ts";
import { benchmarkMsm, runMsm } from "./msm-twisted-edwards.ts";
import { parseMsmArgs } from "./msm-args.ts";

let { n, nThreads, doEvaluate, options } = parseMsmArgs();

if (doEvaluate)
  await benchmarkMsm(TwistedEdwardsParams.ed377, n, nThreads, options);
else await runMsm(TwistedEdwardsParams.ed377, n, nThreads, options);
