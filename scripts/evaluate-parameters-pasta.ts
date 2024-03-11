import { tic, toc } from "../src/testing/tictoc.js";
import {
  msmUnsafe,
  Field,
  Scalar,
  CurveAffine,
  Random,
} from "../src/concrete/pasta.js";
import { bigintScalarsToMemory } from "../src/msm.js";
import { evaluateParameters } from "./evaluate-util.js";

let Nmax = 1 << 18;

tic("random points");
let points = Field.getZeroPointers(Nmax, CurveAffine.size);
CurveAffine.randomPoints(points);
let scalars = Random.randomScalars(Nmax);
let scalarPtr = bigintScalarsToMemory(Scalar, scalars);
toc();

tic("warm-up JIT compiler with fixed set of points");
msmUnsafe(scalarPtr, points[0], 1 << 14);
toc();

// input log-sizes to test
let N = [14, 16, 18];

// window width's difference to n-1 to test
// n-1 is thought to be the optimal default
let C = [-2, -1, 0, 1];
// sub bucket log-size, diff to c >> 1 which is thought to be a good default
let C0 = [-1, 0, 1, 2];

evaluateParameters(msmUnsafe, scalarPtr, points[0], N, C, C0);
