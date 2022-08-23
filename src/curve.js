// all this is specialized to G1 of BLS12-381
// x, y and z are pointers to wasm memory, i.e. integers
// they point to 12 legs of 64 bit each which represent numbers moduly 2p, and only 32 bit of each leg is filled
// multiply preserves those properties
import {
  field,
  fieldToUint64Array,
  fromMontgomery,
  modInverseMontgomery,
  modSqrt,
  randomBaseField,
  scalar,
  toMontgomery,
} from "./finite-field.js";
import {
  multiply,
  add,
  subtract,
  isZero,
  storeFieldIn,
  reset,
  emptyFields,
} from "./finite-field.wat.js";
import { extractBitSlice, log2 } from "./util.js";
import { readFieldBytes, writeFieldBytes, writeFieldInto } from "./wasm.js";

export {
  msm,
  randomCurvePoints,
  doubleInPlaceProjective,
  addAssignProjective,
  getScratchSpace,
};

/**
 * @typedef {{x: number; y: number; z: number}} Point
 * @typedef {{x: number; y: number}} AffinePoint
 * @typedef {[xArray: Uint8Array, yArray: Uint8Array, isInfinity: boolean]} CompatiblePoint
 * @typedef {Uint8Array} CompatibleScalar
 */

const curve = {
  zero: { x: field.legs.Rmod, y: field.legs.Rmod, z: field.legs.zero },
};

/**
 *
 * @param {CompatibleScalar[]} scalars
 * @param {CompatiblePoint[]} inputPoints
 */
function msm(scalars, inputPoints) {
  // initialize buckets
  let n = scalars.length;
  let c = log2(n) - 2; // TODO: determine c from n and hand-optimized lookup table
  // TODO: do less computations for last, smaller chunk of scalar
  let K = Math.ceil(256 / c); // number of partitions
  let L = 2 ** c - 1; // number of buckets per partition (skipping the 0 bucket)
  let points = getScratchSpace(n * 3); // initialize points
  let buckets = getScratchSpace(L * K * 3); // initialize buckets
  let bucketSums = getScratchSpace(K * 3);
  let partialSums = getScratchSpace(K * 3);
  let finalSum = getScratchSpace(3);
  let hasBucketPoint = Array(L * K).fill(false);
  let scratchSpace = getScratchSpace(20);
  let affinePoint = takeAffinePoint(scratchSpace);

  // first loop -- compute buckets
  for (let i = 0; i < n; i++) {
    let scalar = scalars[i];
    let inputPoint = inputPoints[i];
    // convert point to projective
    writeFieldBytes(affinePoint.x, inputPoint[0]);
    writeFieldBytes(affinePoint.y, inputPoint[1]);
    toMontgomery(affinePoint.x);
    toMontgomery(affinePoint.y);
    // TODO: make points have contiguous memory representation
    let x = points[i * 2];
    let y = points[i * 2 + 1];
    let z = points[i * 2 + 2];
    let point = { x, y, z };
    fromAffine(point, affinePoint);
    // partition 32-byte scalar into c-bit chunks
    for (let k = 0; k < K; k++) {
      // compute k-th digit from scalar
      let l = extractBitSlice(scalar, k * c, c);
      if (l === 0) continue;
      // get bucket for digit and add point to it
      let idx = k * L + (l - 1);
      let x = buckets[idx * 3];
      let y = buckets[idx * 3 + 1];
      let z = buckets[idx * 3 + 2];
      let bucket = { x, y, z };
      if (hasBucketPoint[idx]) {
        addAssignProjective(scratchSpace, bucket, point);
      } else {
        writePointInto(bucket, point);
        hasBucketPoint[idx] = true;
      }
    }
  }
  // second loop -- sum up buckets to partial sums
  for (let l = L; l > 0; l--) {
    for (let k = 0; k < K; k++) {
      let idx = k * L + (l - 1);
      let bucket = {
        x: buckets[idx * 3],
        y: buckets[idx * 3 + 1],
        z: buckets[idx * 3 + 2],
      };
      let bucketSum = {
        x: bucketSums[k * 3],
        y: bucketSums[k * 3 + 1],
        z: bucketSums[k * 3 + 2],
      };
      let partialSum = {
        x: partialSums[k * 3],
        y: partialSums[k * 3 + 1],
        z: partialSums[k * 3 + 2],
      };
      // TODO: this should have faster paths if a summand is zero
      // (bucket is zero pretty often; bucketSum at the beginning)
      addAssignProjective(scratchSpace, bucketSum, bucket);
      addAssignProjective(scratchSpace, partialSum, bucketSum);
    }
  }
  // third loop -- compute final sum using horner's rule
  let k = K - 1;
  let partialSum = {
    x: partialSums[k * 3],
    y: partialSums[k * 3 + 1],
    z: partialSums[k * 3 + 2],
  };
  writePointInto(finalSum, partialSum);
  k--;
  for (; k >= 0; k--) {
    for (let j = 0; j < c; j++) {
      doubleInPlaceProjective(scratchSpace, finalSum);
    }
    let partialSum = {
      x: partialSums[k * 3],
      y: partialSums[k * 3 + 1],
      z: partialSums[k * 3 + 2],
    };
    addAssignProjective(scratchSpace, finalSum, partialSum);
  }
  // TODO read out and return result
  reset();
}

function getScratchSpace(n) {
  let space = Array(n);
  let n0 = emptyFields(n);
  for (let i = 0, ni = n0; i < n; i++, ni += 96) {
    space[i] = ni;
  }
  return space;
}

/**
 *
 * @param {number} n
 */
function randomCurvePoints(n) {
  let scratchSpace = getScratchSpace(32);
  /**
   * @type {CompatiblePoint[]}
   */
  let points = Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = randomCurvePoint(scratchSpace);
  }
  reset();
  return points;
}

/**
 * @param {number[]} scratchSpace
 * @returns {CompatiblePoint}
 */
function randomCurvePoint([x, y, z, ...scratchSpace]) {
  let { Rmod: one, four } = field.legs;
  writeFieldInto(x, fieldToUint64Array(randomBaseField()));
  let [ysquare] = scratchSpace;

  // let i = 0;
  while (true) {
    // compute y^2 = x^3 + 4
    multiply(ysquare, x, x);
    multiply(ysquare, ysquare, x);
    add(ysquare, ysquare, four);

    // try computing square root to get y (works half the time, because half the field elements are squares)
    let isRoot = modSqrt(scratchSpace, y, ysquare);
    if (isRoot) break;
    // if it didn't work, increase x by 1 and try again
    add(x, x, one);
  }
  storeFieldIn(z, one);
  let p = { x, y, z };
  let minusZP = takePoint(scratchSpace);
  // clear cofactor
  scaleProjective(scratchSpace, minusZP, scalar.asBits.minusZ, p); // -z*p
  addAssignProjective(scratchSpace, p, minusZP); // p = p - z*p = -(z - 1) * p
  // convert to affine point, back to normal representation and to byte arrays
  let affineP = takeAffinePoint(scratchSpace);
  toAffine(scratchSpace, affineP, p);
  fromMontgomery(affineP.x);
  fromMontgomery(affineP.y);
  return [readFieldBytes(affineP.x), readFieldBytes(affineP.y), false];
}

/**
 * @param {number[]} scratchSpace
 * @param {AffinePoint} affine affine representation
 * @param {Point} point projective representation
 */
function toAffine([zinv, ...scratchSpace], { x: x0, y: y0 }, { x, y, z }) {
  // return x/z, y/z
  modInverseMontgomery(scratchSpace, zinv, z);
  multiply(x0, x, zinv);
  multiply(y0, y, zinv);
}

/**
 *
 * @param {Point} point
 * @param {AffinePoint} affinePoint
 */
function fromAffine({ x, y, z }, affinePoint) {
  storeFieldIn(x, affinePoint.x);
  storeFieldIn(y, affinePoint.y);
  storeFieldIn(z, field.legs.Rmod); // 1
}

/**
 * @param {number[]} scratchSpace
 * @param {Point} result
 * @param {boolean[]} scalar
 * @param {Point} point
 */
function scaleProjective([x, y, z, ...scratchSpace], result, scalar, point) {
  writePointInto(result, curve.zero);
  point = writePointInto({ x, y, z }, point);
  for (let bit of scalar) {
    if (bit) {
      addAssignProjective(scratchSpace, result, point);
    }
    doubleInPlaceProjective(scratchSpace, point);
  }
}

/**
 * point *= 2
 * @param {number[]} scratchSpace
 * @param {Point} point
 */
function doubleInPlaceProjective([W, S, SS, SSS, B, H], { x, y, z }) {
  if (isZero(z)) {
    // console.log("double: z is zero");
    return;
  }
  let eight = field.legs.eight;
  // const W = x.multiply(x).multiply(3n);
  multiply(W, x, x);
  add(S, W, W);
  add(W, S, W);
  // const S = y.multiply(z);
  multiply(S, y, z);
  // const SS = S.multiply(S);
  multiply(SS, S, S);
  // const SSS = SS.multiply(S);
  multiply(SSS, SS, S);
  // const B = x.multiply(y).multiply(S);
  multiply(B, x, y);
  multiply(B, B, S);
  let fourB = B;
  add(B, B, B);
  add(fourB, B, B);
  // const H = W.multiply(W).subtract(B.multiply(8n));
  multiply(H, W, W);
  subtract(H, H, fourB);
  subtract(H, H, fourB);
  // const X3 = H.multiply(S).multiply(2n);
  multiply(x, H, S);
  add(x, x, x);
  // const Y3 = W.multiply(B.multiply(4n).subtract(H)).subtract(
  //   y.multiply(y).multiply(8n).multiply(SS)
  // );
  let fourBminusH = H;
  subtract(fourBminusH, fourB, H);
  let WtimesFourBminusH = H;
  multiply(WtimesFourBminusH, W, fourBminusH);
  multiply(y, y, y);
  multiply(y, y, eight);
  multiply(y, y, SS);
  subtract(y, WtimesFourBminusH, y);
  // const Z3 = SSS.multiply(8n);
  multiply(z, SSS, eight);
}

/**
 * p1 += p2
 * @param {number[]} scratchSpace
 * @param {Point} p1
 * @param {Point} p2
 */
function addAssignProjective(
  [u1, u2, v1, v2, u, v, vv, vvv, v2vv, w, a],
  p1,
  { x: x2, y: y2, z: z2 }
) {
  // if (p1.isZero()) return p2;
  // if (p2.isZero()) return p1;
  let { x: x1, y: y1, z: z1 } = p1;
  if (isZero(z1)) {
    writePointInto(p1, { x: x2, y: y2, z: z2 });
    return;
  }
  if (isZero(z2)) {
    return;
  }
  // const U1 = Y2.multiply(Z1);
  // const U2 = Y1.multiply(Z2);
  // const V1 = X2.multiply(Z1);
  // const V2 = X1.multiply(Z2);
  multiply(u1, y2, z1);
  multiply(u2, y1, z2);
  multiply(v1, x2, z1);
  multiply(v2, x1, z2);
  // if (V1.equals(V2) && U1.equals(U2)) return this.double();
  // if (V1.equals(V2)) return this.getZero();
  // const U = U1.subtract(U2);
  subtract(u, u1, u2);
  // const V = V1.subtract(V2);
  subtract(v, v1, v2);
  // const VV = V.multiply(V);
  multiply(vv, v, v);
  // const VVV = VV.multiply(V);
  multiply(vvv, vv, v);
  // const V2VV = V2.multiply(VV);
  multiply(v2vv, v2, vv);
  // const W = Z1.multiply(Z2);
  multiply(w, z1, z2);
  // const A = U.multiply(U).multiply(W).subtract(VVV).subtract(V2VV.multiply(2n));
  multiply(a, u, u);
  multiply(a, a, w);
  subtract(a, a, vvv);
  subtract(a, a, v2vv);
  subtract(a, a, v2vv);
  // const X3 = V.multiply(A);
  multiply(x1, v, a);
  // const Z3 = VVV.multiply(W);
  multiply(z1, vvv, w);
  // const Y3 = U.multiply(V2VV.subtract(A)).subtract(VVV.multiply(U2));
  subtract(v2vv, v2vv, a);
  multiply(vvv, vvv, u2);
  multiply(y1, u, v2vv);
  subtract(y1, y1, vvv);
}

/**
 *
 * @param {Point} targetPoint
 * @param {Point} point
 */
function writePointInto(targetPoint, point) {
  storeFieldIn(targetPoint.x, point.x);
  storeFieldIn(targetPoint.y, point.y);
  storeFieldIn(targetPoint.z, point.z);
  return targetPoint;
}

/**
 *
 * @param {number[]} scratchSpace
 * @returns
 */
function takePoint(scratchSpace) {
  let [x, y, z] = scratchSpace.splice(0, 3);
  return { x, y, z };
}
/**
 *
 * @param {number[]} scratchSpace
 * @returns
 */
function takeAffinePoint(scratchSpace) {
  let [x, y] = scratchSpace.splice(0, 2);
  return { x, y };
}
