/**
 * this contains some helpers for debugging, which are currently unused only because we aren't, at this moment, debugging something
 */
import {
  affineCoords,
  isZeroAffine,
  isZeroProjective,
  projectiveCoords,
} from "../curve.js";
import { modInverse } from "../finite-field-js.js";
import {
  readBigInt,
  mod,
  p,
  inverse,
  multiply,
  n,
  w,
} from "../finite-field.js";

export {
  readAffine,
  readProjective,
  readProjectiveAsAffine,
  assertOnCurveAffine,
  assertOnCurveProjective,
  printAffine,
};

function readAffine(P) {
  let isZero = isZeroAffine(P);
  let [x, y] = affineCoords(P);
  return {
    x: mod(readBigInt(x), p),
    y: mod(readBigInt(y), p),
    isZero,
  };
}
function readProjective(P) {
  let isZero = isZeroProjective(P);
  let [x, y, z] = projectiveCoords(P);
  return {
    x: readBigInt(x),
    y: readBigInt(y),
    z: readBigInt(z),
    isZero,
  };
}
function readProjectiveAsAffine(scratchSpace, P) {
  let isZero = isZeroProjective(P);
  if (isZero) {
    let [x, y] = projectiveCoords(P);
    return { x: readBigInt(x), y: readBigInt(y), isZero: true };
  }
  let [x1, y1] = toAffineBigints(scratchSpace, P);
  return { x: x1, y: y1, isZero };
}

/**
 * @param {number[]} scratchSpace
 * @param {number} point projective representation
 */
function toAffineBigints([zinv, x1, y1, ...scratchSpace], P) {
  let [x, y, z] = projectiveCoords(P);
  // return x/z, y/z
  inverse(scratchSpace[0], zinv, z);
  multiply(x1, x, zinv);
  multiply(y1, y, zinv);
  return [mod(readBigInt(x1), p), mod(readBigInt(y1), p)];
}

let Rinv = modInverse(1n << BigInt(n * w), p);

/**
 * asserts that a point (x,y) satisfies y^2 = x^3 + 4
 * @param {number} P
 */
function assertOnCurveAffine(P, message = "") {
  let { x, y, isZero } = readAffine(P);
  if (isZero) return;
  // un-montgomery
  x = mod(x * Rinv, p);
  y = mod(y * Rinv, p);
  let xCubedPlusB = mod(x * x * x + 4n, p);
  let ySquared = mod(y * y, p);
  if (xCubedPlusB !== ySquared)
    throw Error(`not on curve; ${message}
{ x: ${x}, y: ${y}, isZero: ${isZero} }`);
}

function assertOnCurveProjective(P, message = "") {
  let { x, y, z, isZero } = readProjective(P);
  if (isZero) return;
  x = mod(x * Rinv, p);
  y = mod(y * Rinv, p);
  z = mod(z * Rinv, p);
  let xCubedPlusB = mod(x * x * x + 4n * z * z * z, p);
  let ySquared = mod(y * y * z, p);
  if (xCubedPlusB !== ySquared)
    throw Error(`not on curve; ${message}
  { x: ${x}, y: ${y}, z: ${z}, isZero: ${isZero} }`);
}

function printAffine(P) {
  let { x, y, isZero } = readAffine(P);
  console.log(`{ x: ${x}, y: ${y}, isZero: ${isZero}`);
}
