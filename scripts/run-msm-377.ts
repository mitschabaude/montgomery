import { curveParams } from "../src/concrete/bls12-377.params.js";
import { benchmarkMsm, runMsm } from "./run-msm-weierstrass.js";

let n = 16;
let nThreads = 16;
let doEvaluate = false;

if (typeof process !== "undefined") {
  console.log(process.argv.slice(3));
  n = Number(process.argv[3] ?? 16);
  nThreads = Number(process.argv[4] ?? 16);
  doEvaluate = process.argv[5] === "--evaluate";
}

if (!doEvaluate) {
  await runMsm(curveParams, n, nThreads);
} else {
  await benchmarkMsm(curveParams, n, nThreads);
}
