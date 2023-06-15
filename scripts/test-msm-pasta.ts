import { tic, toc } from "../src/extra/tictoc.js";
import { webcrypto } from "node:crypto";
import { Field, CurveAffine, Random } from "../src/concrete/pasta.js";
import {
  msm,
  bigintScalarsToMemory,
  toAffineOutputBigint,
} from "../src/msm-pasta.js";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19)
  (globalThis as any).crypto = webcrypto;

let n = Number(process.argv[2] ?? 14);
let N = 1 << n;
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("random points");
let points = Field.getZeroPointers(N, CurveAffine.sizeAffine);
let scratch = Field.getPointers(20);
CurveAffine.randomCurvePoints(scratch, points);

let scalars = Random.randomScalars(N);
let scalarPtr = bigintScalarsToMemory(scalars);
toc();

tic("msm (ours)");
let result = msm(scalarPtr, points[0], N);
let S = toAffineOutputBigint(scratch, result);
toc();

console.log({ S });
