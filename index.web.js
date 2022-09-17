import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.js";
import { tic, toc } from "./src/tictoc.web.js";
import { load } from "./src/store-inputs.web.js";
import { msmAffine } from "./src/curve-affine.js";

let n = 14;
console.log(`running msm with 2^${n} inputs`);

tic("load inputs & convert to rust");
let { points, scalars } = await load(n);
// TODO: loading into Rust memory fails for n >= 15
// let scalarVec = ScalarVectorInput.fromJsArray(scalars);
// let pointVec = PointVectorInput.fromJsArray(points);
toc();

// tic("msm (rust)");
// compute_msm(pointVec, scalarVec);
// toc();

tic("msm (ours)");
msmAffine(scalars, points);
toc();
