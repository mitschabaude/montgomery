import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.node.js";
import { randomScalars } from "./src/finite-field.js";
import { msm, randomCurvePoints } from "./src/curve.js";

let n = 16;
let t0, t1;

// t0 = performance.now();
// const pointVec = new PointVectorInput(2 ** n);
// const scalarVec = new ScalarVectorInput(2 ** n);
// t1 = performance.now();
// console.log(`create inputs (rust): ${((t1 - t0) / 1000).toFixed(3)} sec`);

t0 = performance.now();
let points = randomCurvePoints(2 ** n);
t1 = performance.now();
console.log(`create inputs (js): ${((t1 - t0) / 1000).toFixed(3)} sec`);

let scalars = randomScalars(2 ** n);

// t0 = performance.now();
// let scalarVec = ScalarVectorInput.fromJsArray(scalars);
// let pointVec = PointVectorInput.fromJsArray(points);
// t1 = performance.now();
// console.log(`convert inputs from js: ${((t1 - t0) / 1000).toFixed(3)} sec`);

// t0 = performance.now();
// compute_msm(pointVec, scalarVec);
// t1 = performance.now();
// console.log(`msm (rust): ${((t1 - t0) / 1000).toFixed(3)} sec`);

t0 = performance.now();
msm(scalars, points);
// msm(scalarVec.toJsArray(), pointVec.toJsArray());
t1 = performance.now();
console.log(`msm (ours): ${((t1 - t0) / 1000).toFixed(3)} sec`);
