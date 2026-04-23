import { curveParams } from "../src/concrete/bls12-377.params.ts";
import { benchmarkMsm, runMsm } from "./msm-weierstrass.ts";

console.log(process.argv.slice(2));
let n = Number(process.argv[2] ?? 16);
let nThreads = Number(process.argv[3] ?? 16);
let doEvaluate = process.argv[4] === "--evaluate";

if (doEvaluate) await benchmarkMsm(curveParams, n, nThreads);
else await runMsm(curveParams, n, nThreads);
