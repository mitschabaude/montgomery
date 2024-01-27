import { tic, toc } from "../src/extra/tictoc.web.js";
import {
  msm,
  Field,
  CurveAffine,
  Random,
  Scalar,
} from "../src/concrete/pasta.js";
import { bigintScalarsToMemory } from "../src/msm.js";

let n = 18;
let N = 1 << n;
console.log(`running msm with 2^${n} inputs`);

tic("random points");
let points = Field.getZeroPointers(N, CurveAffine.size);
let scratch = Field.getPointers(20);
CurveAffine.randomPoints(scratch, points);

let scalars = Random.randomScalars(N);
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
toc();

tic("warm-up JIT compiler with fixed points");
msm(scalarPtr, points[0], 1 << 12);
toc();
await new Promise((r) => setTimeout(r, 100));

tic("msm (ours)");
msm(scalarPtr, points[0], N);
toc();
