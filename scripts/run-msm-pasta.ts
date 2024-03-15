import { pallasParams } from "../src/concrete/pasta.params.js";
import { benchmarkMsm, runMsm } from "./run-msm-weierstrass.js";

console.log(process.argv.slice(3));
let n = Number(process.argv[3] ?? 16);
let nThreads = Number(process.argv[4] ?? 16);
let doEvaluate = process.argv[5] === "--evaluate";

if (doEvaluate) await benchmarkMsm(pallasParams, n, nThreads);
else await runMsm(pallasParams, n, nThreads);
