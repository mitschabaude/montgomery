import { curveParams } from "../src/concrete/ed-on-bls12-377.params.js";
import { benchmarkMsm, runMsm } from "./msm-twisted-edwards.js";

console.log(process.argv.slice(3));
let n = Number(process.argv[3] ?? 16);
let nThreads = Number(process.argv[4] ?? 16);
let doEvaluate = process.argv[5] === "--evaluate";

if (doEvaluate) await benchmarkMsm(curveParams, n, nThreads);
else await runMsm(curveParams, n, nThreads);
