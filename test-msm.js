import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.node.js";
import { msm } from "./src/curve.js";
import { tic, toc } from "./src/tictoc.js";
import { webcrypto } from "node:crypto";
import { mod, p } from "./src/finite-field.js";
import { msmAffine } from "./src/curve-affine.js";
import { bigintFromBytes } from "./src/util.js";
import { modInverse } from "./src/finite-field-js.js";
import { msmDumbAffine } from "./src/dumb-curve-affine.js";
import { load } from "./src/store-inputs.js";
// web crypto compat
globalThis.crypto = webcrypto;

let runSlowMsm = false;

let n = process.argv[2] ?? 14;
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("load inputs & convert to rust");
let points, scalars, pointVec, scalarVec;
let loaded = await load(n);
points = loaded.points;
scalars = loaded.scalars;
// pointVec = new PointVectorInput(2 ** n);
// scalarVec = new ScalarVectorInput(2 ** n);
// points = pointVec.toJsArray();
// scalars = scalarVec.toJsArray();
// points = randomCurvePoints(2 ** n);
// scalars = randomScalars(2 ** n);
// custom test data
// points = [points[0], points[1]];
// scalars = [bigintToBytes(5n, 32), bigintToBytes(2n, 32)];
// scalars = Array(2 ** n)
//   .fill(0)
//   .map(() => bigintToBytes(1n, 32));

scalarVec = ScalarVectorInput.fromJsArray(scalars);
pointVec = PointVectorInput.fromJsArray(points);
toc();

tic("msm (rust)");
let [xRefBytes, yRefBytes, zRefBytes] = compute_msm(pointVec, scalarVec);
toc();

let xRefProj = bigintFromBytes(xRefBytes);
let yRefProj = bigintFromBytes(yRefBytes);
let zRefProj = bigintFromBytes(zRefBytes);
let [xRef, yRef] = toAffineFromJacobi(xRefProj, yRefProj, zRefProj);

let xBigint, yBigint;
if (runSlowMsm) {
  tic("msm (dumb)");
  [xBigint, yBigint] = msmDumbAffine(scalars, points);
  toc();
}

tic("msm (projective)");
let resultProj = msm(scalars, points);
toc();
let xProjProj = mod(resultProj.x, p);
let yProjProj = mod(resultProj.y, p);
let zProjProj = mod(resultProj.z, p);
let [xProj, yProj] = toAffine(xProjProj, yProjProj, zProjProj);
let numberOfAddsProj = resultProj.numberOfAdds;
let numberOfDoublesProj = resultProj.numberOfDoubles;
// console.log(resultProj.nMul1 + resultProj.nMul2 + resultProj.nMul3);

tic("msm (ours)");
let result = msmAffine(scalars, points);
toc();
let xAffProj = mod(result.x, p);
let yAffProj = mod(result.y, p);
let zAffProj = mod(result.z, p);
let [xAff, yAff] = toAffine(xAffProj, yAffProj, zAffProj);
let numberOfAddsAff = result.numberOfAdds;
let numberOfDoublesAff = result.numberOfDoubles;
// console.log(result.nMul1 + result.nMul2 + result.nMul3);

console.log({
  numberOfAddsProj,
  numberOfDoublesProj,
  numberOfAddsAff,
  numberOfDoublesAff,
});

if (runSlowMsm) {
  console.log("big === ref", { x: xRef === xBigint, y: yRef === yBigint });
  console.log("big === proj", { x: xBigint === xProj, y: yBigint === yProj });
  console.log("big === aff", { x: xBigint === xAff, y: yBigint === yAff });
}
console.log("ref === proj", { x: xRef === xProj, y: yRef === yProj });
console.log("ref === aff", { x: xRef === xAff, y: yRef === yAff });

console.log("proj === aff", { x: xProj === xAff, y: yProj === yAff });

// console.log(xBigint);
// console.log(xRef);
// console.log(xProj);
// console.log(xAff);

function toAffine(x, y, z) {
  if (z === 0n) return [0n, 0n, true];
  let zInv = modInverse(z, p);
  return [mod(x * zInv, p), mod(y * zInv, p)];
}
function toAffineFromJacobi(x, y, z) {
  if (z === 0n) return [0n, 0n, true];
  let zInv = modInverse(z, p);
  let zInvSquared = mod(zInv * zInv, p);
  return [mod(x * zInvSquared, p), mod(y * zInvSquared * zInv, p)];
}
