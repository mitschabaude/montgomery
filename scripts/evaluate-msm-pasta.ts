// TODO get this to run by fixing memory leaks in base msm

import { tic, toc } from "../src/extra/tictoc.js";
import {
  msmUnsafe,
  Field,
  Scalar,
  CurveAffine,
  Random,
} from "../src/concrete/pasta.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import { webcrypto } from "node:crypto";
import { evaluate } from "./evaluate-util.js";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19) {
  globalThis.crypto = webcrypto as any;
}

// input log-sizes to test
let N = [14, 16, 18];
let Nmax = 1 << Math.max(...N);

tic("random points");
let points = Field.getZeroPointers(Nmax, CurveAffine.sizeAffine);
let scratch = Field.getPointers(20);
CurveAffine.randomCurvePoints(scratch, points);
let scalars = Random.randomScalars(Nmax);
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
let pointPtr = points[0];
toc();

tic("warm-up JIT compiler with fixed set of points");
msmUnsafe(scalarPtr, pointPtr, 1 << 14);
await new Promise((r) => setTimeout(r, 100));
msmUnsafe(scalarPtr, pointPtr, 1 << 14);
await new Promise((r) => setTimeout(r, 100));
toc();

let times = evaluate(msmUnsafe, scalarPtr, pointPtr, N);
console.dir(times, { depth: Infinity });
