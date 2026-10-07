import { CurveParams } from "../src/index.ts";
import { benchmarkMsm, runMsm } from "./msm-weierstrass.ts";
import { parseMsmArgs } from "./msm-args.ts";

let { n, nThreads, doEvaluate, options } = parseMsmArgs();

if (doEvaluate) await benchmarkMsm(CurveParams.bls12377, n, nThreads, options);
else await runMsm(CurveParams.bls12377, n, nThreads, options);
