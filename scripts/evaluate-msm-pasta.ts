import "../src/extra/fix-webcrypto.js";
import { tic, toc } from "../src/extra/tictoc.js";
import {
  msmUnsafe,
  Field,
  Scalar,
  CurveAffine,
  Random,
} from "../src/concrete/pasta.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import { evaluate } from "./evaluate-util.js";

// input log-sizes to test
let N = [14, 16, 18];
let Nmax = 1 << Math.max(...N);

tic("random points");
let points = Field.getZeroPointers(Nmax, CurveAffine.sizeAffine);
let scratch = Field.getPointers(20);

CurveAffine.randomPoints(scratch, points);
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
