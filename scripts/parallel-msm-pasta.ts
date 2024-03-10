import {
  p,
  q,
  b,
  beta,
  lambda,
  curveParams,
} from "../src/concrete/pasta.params.js";
import { benchmarkMsm, runMsm } from "./parallel-msm.js";

const pallasMsmParams = { p, q, b, beta, lambda };

let n = 12;
let nThreads = 16;
let doEvaluate = false;

if (typeof window === "undefined") {
  n = Number(process.argv[3] ?? 16);
  nThreads = Number(process.argv[4] ?? 16);
  doEvaluate = process.argv[5] === "--evaluate";
}

if (!doEvaluate) {
  await runMsm(n, nThreads, pallasMsmParams, curveParams);
} else {
  await benchmarkMsm(n, nThreads, pallasMsmParams);
}
