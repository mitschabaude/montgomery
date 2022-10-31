import {
  addAffine,
  add,
  subtract,
  multiply,
  square,
  copy,
  constants,
  memoryBytes,
  n,
} from "./finite-field.js";
export {
  addAffine,
  doubleAffine,
  sizeField,
  sizeAffine,
  sizeProjective,
  isZeroAffine,
  isZeroProjective,
  copyAffine,
  copyProjective,
  copyAffineToProjectiveNonZero,
  affineCoords,
  projectiveCoords,
  setNonZeroProjective,
  setNonZeroAffine,
};

let sizeField = 8 * n;
let sizeAffine = 16 * n + 8;
let sizeProjective = 24 * n + 8;

/**
 * affine EC doubling, H = 2*G
 *
 * assuming d = 1/(2*y) is given, and inputs aren't zero.
 *
 * this supports doubling a point in-place with H === G
 * @param {number[]} scratch
 * @param {number} H output point
 * @param {number} G input point (x, y)
 * @param {number} d 1/(2y)
 */
function doubleAffine([m, tmp, x2, y2], H, G, d) {
  let [x, y] = affineCoords(G);
  let [xOut, yOut] = affineCoords(H);

  // m = 3*x^2*d
  square(m, x);
  add(tmp, m, m); // TODO efficient doubling
  add(m, tmp, m);
  multiply(m, d, m);
  // x2 = m^2 - 2x
  square(x2, m);
  add(tmp, x, x); // TODO efficient doubling
  subtract(x2, x2, tmp);
  // y2 = (x - x2)*m - y
  subtract(y2, x, x2);
  multiply(y2, y2, m);
  subtract(y2, y2, y);
  // H = x2,y2
  copy(xOut, x2);
  copy(yOut, y2);
}

/**
 * @param {number} pointer
 */
function isZeroAffine(pointer) {
  return !memoryBytes[pointer + 2 * sizeField];
}
/**
 * @param {number} pointer
 */
function isZeroProjective(pointer) {
  return !memoryBytes[pointer + 3 * sizeField];
}

/**
 *
 * @param {number} target
 * @param {number} source
 */
function copyAffine(target, source) {
  memoryBytes.copyWithin(target, source, source + sizeAffine);
}
/**
 *
 * @param {number} target
 * @param {number} source
 */
function copyProjective(target, source) {
  memoryBytes.copyWithin(target, source, source + sizeProjective);
}
/**
 * @param {number} P
 * @param {number} A
 */
function copyAffineToProjectiveNonZero(P, A) {
  // x,y = x,y
  memoryBytes.copyWithin(P, A, A + 2 * sizeField);
  // z = 1
  memoryBytes.copyWithin(
    P + 2 * sizeField,
    constants.mg1,
    constants.mg1 + sizeField
  );
  // isNonZero = 1
  memoryBytes[P + 3 * sizeField] = 1;
  // isInfinity = isInfinity
  // memoryBytes[P + 3 * sizeField] = memoryBytes[A + 2 * sizeField];
}

/**
 * @param {number} pointer
 */
function affineCoords(pointer) {
  return [pointer, pointer + sizeField];
}
/**
 * @param {number} pointer
 */
function projectiveCoords(pointer) {
  return [pointer, pointer + sizeField, pointer + 2 * sizeField];
}

/**
 * @param {number} pointer
 */
function setNonZeroProjective(pointer) {
  memoryBytes[pointer + 3 * sizeField] = 1;
}
/**
 * @param {number} pointer
 */
function setNonZeroAffine(pointer) {
  memoryBytes[pointer + 2 * sizeField] = 1;
}
