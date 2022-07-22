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
} from "./finite-field.wat.js";
import { bigintToBytes } from "./util.js";

export { randomCurvePoints, doubleInPlaceProjective, addAssignProjective };

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
  let minusZP = scaleProjective(scalar.asBits.minusZ, p); // -z*p
  addAssignProjective(p, minusZP); // p = p - z*p = -(z - 1) * p
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
 * @param {{x: number, y: number, z:number}} point projective representation
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
 * @param {boolean[]} scalar
 * @param {{x: number, y: number, z:number}} point
 * @param {{ inPlace?: boolean }?}
 * @return {{x: number, y: number, z:number}} scalar * point
 */
function scaleProjective(scalar, point, { inPlace = false } = {}) {
  let result = {
    x: fieldToMontgomeryPointer(1n),
    y: fieldToMontgomeryPointer(1n),
    z: fieldToMontgomeryPointer(0n),
  };
  if (!inPlace) point = copyPoint(point);
  for (let bit of scalar) {
    if (bit) {
      addAssignProjective(result, point);
    }
    doubleInPlaceProjective(point);
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
 * @param {{x: number, y: number, z:number}} point
 */
function doubleInPlaceProjective({ x, y, z }) {
  if (isZero(z)) {
    // console.log("double: z is zero");
    return;
  }
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
  freeField(S);
  freeField(SS);
  freeField(SSS);
  freeField(W);
  freeField(H);
  freeField(B);
  freeField(eight);
}

/**
 * p1 += p2
 * @param {{x: number, y: number, z:number}} p1
 * @param {{x: number, y: number, z:number}} p2
 */
function addAssignProjective(point, { x: x2, y: y2, z: z2 }) {
  // if (p1.isZero()) return p2;
  // if (p2.isZero()) return p1;
  let { x: x1, y: y1, z: z1 } = point;
  if (isZero(z1)) {
    // console.log("add: z1 is zero");
    let newPoint = copyPoint({ x: x2, y: y2, z: z2 });
    point.x = newPoint.x;
    point.y = newPoint.y;
    point.z = newPoint.z;
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
  freeField(v);
  freeField(w);
  freeField(u);
  freeField(u1);
  freeField(u2);
  freeField(v1);
  freeField(v2);
  freeField(vv);
  freeField(vvv);
  freeField(v2vv);
  freeField(a);
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
