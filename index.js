import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.node.js";
import { msm } from "./src/curve.js";
import { tic, toc } from "./src/tictoc.js";
import { load } from "./src/store-inputs.js";

let n = process.argv[2] ?? 14;
console.log(`running msm with 2^${n} inputs`);

tic("load inputs & convert to rust");
let { points, scalars } = await load(n);
let scalarVec = ScalarVectorInput.fromJsArray(scalars);
let pointVec = PointVectorInput.fromJsArray(points);
toc();

tic("msm (rust)");
compute_msm(pointVec, scalarVec);
toc();

tic("msm (ours)");
msm(scalars, points);
toc();
