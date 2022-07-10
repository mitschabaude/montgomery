// all this is specialized to G1 of BLS12-381
// x, y and z are pointers to wasm memory, i.e. integers
// they point to 12 legs of 64 bit each which represent numbers moduly 2p, and only 32 bit of each leg is filled
// multiply preserves those properties
import {
  add,
  field,
  fieldFromMontgomeryPointer,
  fieldToMontgomeryPointer,
  fieldToUint64Array,
  mod,
  modSqrt,
  randomBaseField,
  randomBaseFieldWasm,
  subtract,
} from "./finite-field.js";
import { PointG1, Fp } from "@noble/bls12-381";
import {
  multiply,
  storeField,
  freeField,
  emptyField,
} from "./finite-field.wat.js";
import { bigintToBytes } from "./util.js";

export { randomCurvePoints };

function randomCurvePoints(n) {
  let points = Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = randomCurvePoint();
  }
  return points;
}

/**
 *
 * @returns {[Uint8Array, Uint8Array, boolean]}
 */
function randomCurvePoint() {
  let { R2mod, Rmod } = field.legs;
  let x = randomBaseFieldWasm();
  let four = storeField(fieldToUint64Array(4n));
  multiply(four, four, R2mod); // 4R
  let one = Rmod;
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
    modSqrt(y, ysquare);
    if (y !== undefined) {
      break;
    } else {
      // if it didn't work, increase x by 1 and try again
      add(x, x, one);
      // i++;
    }
  }
  let x_ = fieldFromMontgomeryPointer(x);
  let y_ = fieldFromMontgomeryPointer(y);
  freeField(x);
  freeField(y);
  freeField(ysquare);
  freeField(four);
  let point = new PointG1(new Fp(x_), new Fp(y_));
  let reduced = point.clearCofactor();
  [x_, y_] = reduced.toAffine();
  return [bigintToBytes(x_.value, 48), bigintToBytes(y_.value, 48), false];
}

// double() {
//   const { x, y, z } = this;
//   const W = x.multiply(x).multiply(3n);
//   const S = y.multiply(z);
//   const SS = S.multiply(S);
//   const SSS = SS.multiply(S);
//   const B = x.multiply(y).multiply(S);
//   const H = W.multiply(W).subtract(B.multiply(8n));
//   const X3 = H.multiply(S).multiply(2n);
//   const Y3 = W.multiply(B.multiply(4n).subtract(H)).subtract(y.multiply(y).multiply(8n).multiply(SS));
//   const Z3 = SSS.multiply(8n);
//   return this.createPoint(X3, Y3, Z3);
// }

/**
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 */
function projectiveDouble(x, y, z) {
  let eight = fieldToMontgomeryPointer(8n);
  // const W = x.multiply(x).multiply(3n);
  let W = emptyField();
  multiply(W, x, y);
  // const S = y.multiply(z);
  let S = emptyField();
  multiply(S, y, z);
  // const SS = S.multiply(S);
  let SS = emptyField();
  multiply(SS, S, S);
  // const SSS = SS.multiply(S);
  let SSS = emptyField();
  multiply(SSS, SS, S);
  // const B = x.multiply(y).multiply(S);
  let B = emptyField();
  multiply(B, x, y);
  multiply(B, B, S);
  let fourB = B;
  add(B, B, B);
  add(fourB, B, B);
  // const H = W.multiply(W).subtract(B.multiply(8n));
  let H = emptyField();
  multiply(H, W, W);
  subtract(H, H, fourB);
  subtract(H, H, fourB);
  // const X3 = H.multiply(S).multiply(2n);
  let x2 = S;
  multiply(x2, H, S);
  add(x2, x2, x2);
  // const Y3 = W.multiply(B.multiply(4n).subtract(H)).subtract(
  //   y.multiply(y).multiply(8n).multiply(SS)
  // );
  let fourBminusH = H;
  subtract(fourBminusH, fourB, H);
  let WtimesFourBminusH = H;
  multiply(WtimesFourBminusH, W, fourBminusH);
  let y2 = SS;
  multiply(y2, SS, eight);
  multiply(y2, y2, y);
  multiply(y2, y2, y);
  subtract(y2, WtimesFourBminusH, y2);
  // const Z3 = SSS.multiply(8n);
  let z2 = SSS;
  multiply(z2, SSS, eight);
  freeField(W);
  freeField(H);
  freeField(B);
  freeField(eight);
  // return this.createPoint(X3, Y3, Z3);
  return { x: x2, y: y2, z: z2 };
}

let P = randomCurvePoint();

// add(rhs) {
//   if (this.constructor !== rhs.constructor)
//       throw new Error(`ProjectivePoint#add: this is ${this.constructor}, but rhs is ${rhs.constructor}`);
//   const p1 = this;
//   const p2 = rhs;
//   if (p1.isZero())
//       return p2;
//   if (p2.isZero())
//       return p1;
//   const X1 = p1.x;
//   const Y1 = p1.y;
//   const Z1 = p1.z;
//   const X2 = p2.x;
//   const Y2 = p2.y;
//   const Z2 = p2.z;
//   const U1 = Y2.multiply(Z1);
//   const U2 = Y1.multiply(Z2);
//   const V1 = X2.multiply(Z1);
//   const V2 = X1.multiply(Z2);
//   if (V1.equals(V2) && U1.equals(U2))
//       return this.double();
//   if (V1.equals(V2))
//       return this.getZero();
//   const U = U1.subtract(U2);
//   const V = V1.subtract(V2);
//   const VV = V.multiply(V);
//   const VVV = VV.multiply(V);
//   const V2VV = V2.multiply(VV);
//   const W = Z1.multiply(Z2);
//   const A = U.multiply(U).multiply(W).subtract(VVV).subtract(V2VV.multiply(2n));
//   const X3 = V.multiply(A);
//   const Y3 = U.multiply(V2VV.subtract(A)).subtract(VVV.multiply(U2));
//   const Z3 = VVV.multiply(W);
//   return this.createPoint(X3, Y3, Z3);
// }
