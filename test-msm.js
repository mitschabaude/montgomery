import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.node.js";
import { msm } from "./src/curve.js";
import { tic, toc } from "./src/tictoc.js";
import { load } from "./src/store-inputs.js";
import { webcrypto } from "node:crypto";
import { mod, p } from "./src/finite-field.js";
import { msmAffine } from "./src/curve-affine.js";
import { bigintFromBytes, bigintToBits, bigintToBytes } from "./src/util.js";
import { modInverse } from "./src/finite-field-js.js";
// web crypto compat
globalThis.crypto = webcrypto;

let n = process.argv[2] ?? 14;
console.log(`running msm with 2^${n} = ${2 ** n} inputs`);

tic("load inputs & convert to rust");
let points, scalars;
let loaded = await load(n);
points = loaded.points;
scalars = loaded.scalars;
// custom test data
points = [points[0], points[1]];
scalars = [bigintToBytes(312482189n, 32), bigintToBytes(312482189n, 32)];

let scalarVec = ScalarVectorInput.fromJsArray(scalars);
let pointVec = PointVectorInput.fromJsArray(points);
toc();

tic("msm (rust)");
let [xRefBytes, yRefBytes, zRefBytes] = compute_msm(pointVec, scalarVec);
toc();

let xRefProj = bigintFromBytes(xRefBytes);
let yRefProj = bigintFromBytes(yRefBytes);
let zRefProj = bigintFromBytes(zRefBytes);
let [xRef, yRef] = toAffineFromJacobi(xRefProj, yRefProj, zRefProj);

tic("msm (dumb)");
let [xBigint, yBigint] = msmDumbBigint(scalars, points);
toc();

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

console.log("ref === big", { x: xRef === xBigint, y: yRef === yBigint });
console.log("ref === proj", { x: xRef === xProj, y: yRef === yProj });
console.log("ref === aff", { x: xRef === xAff, y: yRef === yAff });

console.log("big === proj", { x: xBigint === xProj, y: yBigint === yProj });
console.log("big === aff", { x: xBigint === xAff, y: yBigint === yAff });

console.log("proj === aff", { x: xProj === xAff, y: yProj === yAff });

console.log(xRef);
console.log(xBigint);
console.log(xProj);
console.log(xAff);

function toAffine(x, y, z) {
  let zInv = modInverse(z, p);
  return [mod(x * zInv, p), mod(y * zInv, p)];
}
function toAffineFromJacobi(x, y, z) {
  let zInv = modInverse(z, p);
  let zInvSquared = mod(zInv * zInv, p);
  return [mod(x * zInvSquared, p), mod(y * zInvSquared * zInv, p)];
}

function fromMontgomery_(x) {
  let Rinv = modInverse(mod(1n << 384n, p), p);
  return mod(x * Rinv, p);
}

function addAffine([x1, y1, isZero1], [x2, y2, isZero2]) {
  if (isZero1) return [x2, y2, isZero2];
  if (isZero2) return [x1, y1, isZero1];
  if (x1 === x2) {
    if (y1 === y2) {
      // P1 + P1 --> we double
      return doubleAffine([x1, y1, isZero1]);
    }
    if (y1 === -y2) {
      // P1 - P1 --> return zero
      return [0n, 0n, true];
    }
  }
  // m = (y2 - y1)/(x2 - x1)
  let d = modInverse(x2 - x1, p);
  let m = mod((y2 - y1) * d, p);
  // x3 = m^2 - x1 - x2
  let x3 = mod(m * m - x1 - x2, p);
  // y3 = m*(x1 - x3) - y1
  let y3 = mod(m * (x1 - x3) - y1, p);
  return [x3, y3, false];
}
function doubleAffine([x, y, isZero]) {
  if (isZero) return [0n, 0n, true];
  // m = 3*x^2 / 2y
  let d = modInverse(2n * y, p);
  let m = mod(3n * x * x * d, p);
  // x2 = m^2 - 2x
  let x2 = mod(m * m - 2n * x, p);
  // y2 = m*(x - x2) - y
  let y2 = mod(m * (x - x2) - y, p);
  return [x2, y2, false];
}
function scale(scalar, point) {
  let result = [0n, 0n, true];
  for (let bit of scalar) {
    if (bit) {
      result = addAffine(result, point);
    }
    point = doubleAffine(point);
  }
  return result;
}

/**
 *
 * @param {import("./src/curve.js").CompatibleScalar[]} scalars
 * @param {import("./src/curve.js").CompatiblePoint[]} points
 */
function msmDumbBigint(scalars, points) {
  let n = scalars.length;

  let pointsBigint = points.map((P) => {
    let x = bigintFromBytes(P[0]);
    let y = bigintFromBytes(P[1]);
    let isZero = P[2];
    return [x, y, isZero];
  });
  let scalarsBits = scalars.map((s) => {
    let bigint = bigintFromBytes(s);
    return bigintToBits(bigint);
  });
  let sum = [0n, 0n, true];
  for (let i = 0; i < n; i++) {
    let s = scalarsBits[i];
    let P = pointsBigint[i];
    let Q = scale(s, P);
    sum = addAffine(sum, Q);
  }
  return sum;
}
