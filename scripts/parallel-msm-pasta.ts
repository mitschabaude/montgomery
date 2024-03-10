import { pallasParams } from "../src/concrete/pasta.params.js";
import { benchmarkMsm, runMsm } from "./parallel-msm.js";

let n = 12;
let nThreads = 16;
let doEvaluate = false;

if (typeof window === "undefined") {
  n = Number(process.argv[3] ?? 16);
  nThreads = Number(process.argv[4] ?? 16);
  doEvaluate = process.argv[5] === "--evaluate";
}

if (!doEvaluate) {
  await runMsm(pallasParams, n, nThreads);
} else {
  await benchmarkMsm(pallasParams, n, nThreads);
}
