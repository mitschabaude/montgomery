// all this is specialized to G1 of BLS12-381
// x, y and z are pointers to wasm memory, i.e. integers
// they point to 12 legs of 64 bit each which represent numbers moduly 2p, and only 32 bit of each leg is filled
// multiply preserves those properties
import {
  field,
  fieldFromMontgomeryPointer,
  fieldToMontgomeryPointer,
  isZero,
  modInverseMontgomery,
  modSqrt,
  randomBaseFieldWasm,
  scalar,
} from "./finite-field.js";
import {
  multiply,
  add,
  subtract,
  freeField,
  emptyField,
  readField,
  storeField,
  storeFieldIn,
  reset,
} from "./finite-field.wat.js";
import { bigintToBytes } from "./util.js";

export { randomCurvePoints, doubleInPlaceProjective, addAssignProjective };

/**
 * @typedef {{x: number; y: number; z: number}} Point
 */

const curve = {
  zero: {
    x: fieldToMontgomeryPointer(1n),
    y: fieldToMontgomeryPointer(1n),
    z: fieldToMontgomeryPointer(0n),
  },
};

function getScratchSpace(n) {
  let space = [];
  for (let i = 0; i < n; i++) {
    space.push(emptyField());
  }
  return space;
}

function randomCurvePoints(n) {
  let scratchSpace = getScratchSpace(20);
  let points = Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = randomCurvePoint(scratchSpace);
  }
  return points;
}

/**
 * @param {number[]} scratchSpace
 * @returns {[Uint8Array, Uint8Array, boolean]}
 */
function randomCurvePoint(scratchSpace) {
  let { Rmod: one } = field.legs;
  let x = randomBaseFieldWasm();
  let four = fieldToMontgomeryPointer(4n);
  let ysquare = emptyField();
  let y = emptyField();

  // let i = 0;
  while (true) {
    // compute y^2 = x^3 + 4
    multiply(ysquare, x, x);
    multiply(ysquare, ysquare, x);
    add(ysquare, ysquare, four);
    // let ysquare = mod(x ** 3n + 4n, field.p);

    // try computing square root to get y (works half the time, because half the field elements are squares)
    // console.log("sqrt", i);
    let yr = modSqrt(y, ysquare);
    if (yr !== undefined) {
      break;
    } else {
      // if it didn't work, increase x by 1 and try again
      add(x, x, one);
      // i++;
    }
  }
  freeField(ysquare);
  freeField(four);

  let p = { x, y, z: fieldToMontgomeryPointer(1n) };
  // clear cofactor
  let minusZP = scaleProjective(scratchSpace, scalar.asBits.minusZ, p); // -z*p
  addAssignProjective(scratchSpace, p, minusZP); // p = p - z*p = -(z - 1) * p
  let affineP = toAffine(p);
  let x0 = fieldFromMontgomeryPointer(affineP.x);
  let y0 = fieldFromMontgomeryPointer(affineP.y);
  freePoint(minusZP);
  freePoint(p);
  freePoint(affineP);
  return [bigintToBytes(x0, 48), bigintToBytes(y0, 48), false];
}

/**
 *
 * @param {Point} point projective representation
 * @return {{x: number, y: number}} affine representation
 */
function toAffine({ x, y, z }) {
  // return x/z, y/z
  let zinv = modInverseMontgomery(z);
  let x0 = emptyField();
  let y0 = emptyField();
  multiply(x0, x, zinv);
  multiply(y0, y, zinv);
  return { x: x0, y: y0 };
}

/**
 * @param {number[]} scratchSpace
 * @param {boolean[]} scalar
 * @param {Point} point
 * @param {{ inPlace?: boolean }?}
 * @return {Point} scalar * point
 */
function scaleProjective(
  scratchSpace,
  scalar,
  point,
  { inPlace = false } = {}
) {
  /** @type {Point} */
  let result = copyPoint(curve.zero);
  if (!inPlace) point = copyPoint(point);
  for (let bit of scalar) {
    if (bit) {
      addAssignProjective(scratchSpace, result, point);
    }
    doubleInPlaceProjective(scratchSpace, point);
    reset();
  }
  if (inPlace) {
    freePoint(point);
    point.x = result.x;
    point.y = result.y;
    point.z = result.z;
    return;
  }
  return result;
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
    // console.log("add: z1 is zero");
    let newPoint = copyPoint({ x: x2, y: y2, z: z2 });
    p1.x = newPoint.x;
    p1.y = newPoint.y;
    p1.z = newPoint.z;
    return;
  }
  if (isZero(z2)) {
    // console.log("add: z2 is zero");
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
 * @param {{x: number, y: number: z?:number}} point
 */
function freePoint({ x, y, z }) {
  freeField(x);
  freeField(y);
  if (z !== undefined) freeField(z);
}

function copyPoint({ x, y, z }) {
  return {
    x: storeField(readField(x)),
    y: storeField(readField(y)),
    z: storeField(readField(z)),
  };
}

/**
 *
 * @param {Point} p
 * @param {Point} q
 * @return {Point}
 */
function copyPointInto(p, q) {
  storeFieldIn(q.x, p.x);
  storeFieldIn(q.y, p.y);
  storeFieldIn(q.z, p.z);
  return p;
}
