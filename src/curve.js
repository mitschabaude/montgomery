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
  isZero,
  modSqrt,
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

export { randomCurvePoints, doubleProjective, addProjective };

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
    modSqrt(y, ysquare);
    if (y !== undefined) {
      break;
    } else {
      // if it didn't work, increase x by 1 and try again
      add(x, x, one);
      // i++;
    }
  }
  // return { x, y };
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

/**
 * @param {{x: number, y: number, z:number}} point
 * @return {{x: number, y: number, z:number}} 2*point
 */
function doubleProjective({ x, y, z }) {
  let eight = fieldToMontgomeryPointer(8n);
  // const W = x.multiply(x).multiply(3n);
  let W = emptyField();
  let S = emptyField();
  multiply(W, x, x);
  add(S, W, W);
  add(W, S, W);
  // const S = y.multiply(z);
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

/**
 * @param {{x: number, y: number, z:number}} p1
 * @param {{x: number, y: number, z:number}} p2
 * @return {{x: number, y: number, z:number}} p1 + p2
 */
function addProjective({ x: x1, y: y1, z: z1 }, { x: x2, y: y2, z: z2 }) {
  // if (p1.isZero()) return p2;
  // if (p2.isZero()) return p1;
  if (isZero(z1)) return { x: x2, y: y2, z: z2 };
  if (isZero(z2)) return { x: x1, y: y1, z: z1 };
  // const U1 = Y2.multiply(Z1);
  // const U2 = Y1.multiply(Z2);
  // const V1 = X2.multiply(Z1);
  // const V2 = X1.multiply(Z2);
  let u1 = emptyField();
  let u2 = emptyField();
  let v1 = emptyField();
  let v2 = emptyField();
  multiply(u1, y2, z1);
  multiply(u2, y1, z2);
  multiply(v1, x2, z1);
  multiply(v2, x1, z2);
  // if (V1.equals(V2) && U1.equals(U2)) return this.double();
  // if (V1.equals(V2)) return this.getZero();
  let u = emptyField();
  let v = emptyField();
  let vv = emptyField();
  let vvv = emptyField();
  let v2vv = emptyField();
  let w = emptyField();
  let a = emptyField();
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
  multiply(w, z1, z1);
  // const A = U.multiply(U).multiply(W).subtract(VVV).subtract(V2VV.multiply(2n));
  multiply(a, u, u);
  multiply(a, a, w);
  subtract(a, a, vvv);
  subtract(a, a, v2vv);
  subtract(a, a, v2vv);
  // const X3 = V.multiply(A);
  let x3 = v;
  multiply(x3, v, a);
  // const Z3 = VVV.multiply(W);
  let z3 = w;
  multiply(z3, vvv, w);
  // const Y3 = U.multiply(V2VV.subtract(A)).subtract(VVV.multiply(U2));
  subtract(v2vv, v2vv, a);
  multiply(vvv, vvv, u2);
  let y3 = u;
  multiply(y3, u, v2vv);
  subtract(y3, y3, vvv);
  freeField(u1);
  freeField(u2);
  freeField(v1);
  freeField(v2);
  freeField(vv);
  freeField(vvv);
  freeField(v2vv);
  freeField(a);
  return { x: x3, y: y3, z: z3 };
}

// let z = fieldToMontgomeryPointer(1n);
// let p1 = { ...randomCurvePoint(), z };
// let p2 = { ...randomCurvePoint(), z };

// let point1 = addProjectiveJs(toPoint(p1), toPoint(p2));
// let point2 = addProjective(p1, p2);
// console.log({
//   x: fieldFromMontgomeryPointer(point2.x) === point1.x.value,
//   y: fieldFromMontgomeryPointer(point2.y) === point1.y.value,
//   z: fieldFromMontgomeryPointer(point2.z) === point1.z.value,
// });

function addProjectiveJs(p1, p2) {
  if (p1.isZero()) return p2;
  if (p2.isZero()) return p1;
  const X1 = p1.x;
  const Y1 = p1.y;
  const Z1 = p1.z;
  const X2 = p2.x;
  const Y2 = p2.y;
  const Z2 = p2.z;
  const U1 = Y2.multiply(Z1);
  const U2 = Y1.multiply(Z2);
  const V1 = X2.multiply(Z1);
  const V2 = X1.multiply(Z2);
  if (V1.equals(V2) && U1.equals(U2)) return p1.double();
  if (V1.equals(V2)) return p1.getZero();
  const U = U1.subtract(U2);
  const V = V1.subtract(V2);
  const VV = V.multiply(V);
  const VVV = VV.multiply(V);
  const V2VV = V2.multiply(VV);
  const W = Z1.multiply(Z2);
  const A = U.multiply(U).multiply(W).subtract(VVV).subtract(V2VV.multiply(2n));
  const X3 = V.multiply(A);
  const Y3 = U.multiply(V2VV.subtract(A)).subtract(VVV.multiply(U2));
  const Z3 = VVV.multiply(W);
  return p1.createPoint(X3, Y3, Z3);
}

function doubleProjectiveJs(point) {
  let { x, y, z } = point;
  const W = x.multiply(x).multiply(3n);
  const S = y.multiply(z);
  const SS = S.multiply(S);
  const SSS = SS.multiply(S);
  const B = x.multiply(y).multiply(S);
  const H = W.multiply(W).subtract(B.multiply(8n));
  const X3 = H.multiply(S).multiply(2n);
  const Y3 = W.multiply(B.multiply(4n).subtract(H)).subtract(
    y.multiply(y).multiply(8n).multiply(SS)
  );
  const Z3 = SSS.multiply(8n);
  return point.createPoint(X3, Y3, Z3);
}

function toPoint({ x, y, z }) {
  let x_ = fieldFromMontgomeryPointer(x);
  let y_ = fieldFromMontgomeryPointer(y);
  let z_ = z && fieldFromMontgomeryPointer(z);
  return new PointG1(new Fp(x_), new Fp(y_), z_ && new Fp(z_));
}
