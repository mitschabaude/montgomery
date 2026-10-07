import { CurveParams } from "../src/index.ts";
import { benchmarkMsm, runMsm } from "./msm-weierstrass.ts";
import { parseMsmArgs } from "./msm-args.ts";

let { n, nThreads, doEvaluate, options } = parseMsmArgs();

if (doEvaluate) await benchmarkMsm(CurveParams.pallas, n, nThreads, options);
else await runMsm(CurveParams.pallas, n, nThreads, options);
