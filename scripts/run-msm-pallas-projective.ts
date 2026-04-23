import { pallasParams } from "../src/concrete/pasta.params.ts";
import { benchmarkMsm, runMsm } from "./msm-weierstrass-projective.ts";

console.log(process.argv.slice(2));
let n = Number(process.argv[2] ?? 16);
let nThreads = Number(process.argv[3] ?? 16);
let doEvaluate = process.argv[4] === "--evaluate";

if (doEvaluate) await benchmarkMsm(pallasParams, n, nThreads);
else await runMsm(pallasParams, n, nThreads);
