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
  scalar,
  subtract,
} from "./finite-field.js";
import { PointG1, Fp } from "@noble/bls12-381";
import {
  multiply,
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
    modSqrt(y, ysquare);
    if (y !== undefined) {
      break;
    } else {
      // if it didn't work, increase x by 1 and try again
      add(x, x, one);
      // i++;
    }
  }
  freeField(ysquare);
  freeField(four);
  // return { x, y };
  // let x0 = fieldFromMontgomeryPointer(x);
  // let y0 = fieldFromMontgomeryPointer(y);

  let p = { x, y, z: fieldToMontgomeryPointer(1n) };
  // clear cofactor
  let minusZP = scaleProjective(scalar.asBits.minusZ, p); // -z*p
  addAssignProjective(p, minusZP); // p = p - z*p = -(z - 1) * p
  let [x_, y_] = toPoint(p).toAffine();
  // {
  //   let p0 = new PointG1(new Fp(x0), new Fp(y0));
  //   let minusZP0 = scaleProjectiveJs(scalar.minusZ, p0); // -z*p
  //   p0 = addProjectiveJs(p0, minusZP0);
  //   let [x__, y__] = p0.toAffine();
  //   if (x__.value !== x_.value) {
  //     console.log(x__.value === x_.value, y__.value === y_.value);
  //     throw Error("not equal");
  //   }
  // }
  // {
  //   let point = new PointG1(new Fp(x0), new Fp(y0));
  //   let reduced = point.clearCofactor();
  //   let [x__, y__] = reduced.toAffine();
  //   if (x__.value !== x_.value) {
  //     console.log(x__.value === x_.value, y__.value === y_.value);
  //     throw Error("not equal");
  //   }
  // }

  freePoint(minusZP);
  freePoint(p);
  return [bigintToBytes(x_.value, 48), bigintToBytes(y_.value, 48), false];
}

/**
 * @param {boolean[]} scalar
 * @param {{x: number, y: number, z:number}} point
 * @param {{ inPlace?: boolean }?}
 * @return {{x: number, y: number, z:number}} scalar * point
 */
function scaleProjective(scalar, point, { inPlace = false } = {}) {
  // console.log("scale");
  let result = {
    x: fieldToMontgomeryPointer(1n),
    y: fieldToMontgomeryPointer(1n),
    z: fieldToMontgomeryPointer(0n),
  };
  if (!inPlace) point = copyPoint(point);
  // printPoint(point);
  for (let bit of scalar) {
    if (bit) {
      // console.log("adding");
      // printPoint(result);
      // printPoint(point);
      addAssignProjective(result, point);
      // console.log("added point, printing");
      // console.log("add result");
      // printPoint(result);
    }
    doubleInPlaceProjective(point);
    // console.log("doubled point, printing");
    // printPoint(point);
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
 *
 * @param {bigint} scalar
 * @param {PointG1} point
 * @returns {PointG1}
 */
function scaleProjectiveJs(scalar, self) {
  // console.log("scale js");
  // let self = new PointG1(new Fp(input.x), new Fp(input.y), new Fp(input.z));
  let n = self.validateScalar(scalar);
  let point = self.getZero();
  while (n > 0n) {
    if (n & 1n) {
      // console.log("adding");
      // console.log({ x: point.x.value, y: point.y.value, z: point.z.value });
      // console.log({ x: self.x.value, y: self.y.value, z: self.z.value });
      point = point.add(self);
      // console.log("add result");
      // console.log({ x: point.x.value, y: point.y.value, z: point.z.value });
    }
    self = self.double();
    n >>= 1n;
  }
  return point;
  // return { x: point.x.value, y: point.y.value, z: point.z.value };
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

function freePoint({ x, y, z }) {
  freeField(x);
  freeField(y);
  freeField(z);
}

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

function printPoint({ x, y, z }) {
  console.log({
    x: fieldFromMontgomeryPointer(x),
    y: fieldFromMontgomeryPointer(y),
    z: fieldFromMontgomeryPointer(z),
  });
}

function copyPoint({ x, y, z }) {
  return {
    x: storeField(readField(x)),
    y: storeField(readField(y)),
    z: storeField(readField(z)),
  };
}

// let p1 = {
//   x: fieldToMontgomeryPointer(
//     3315806368351782560278590083144565489746652636015433566067515073165026418777027645535904290309330490296584060284716n
//   ),
//   y: fieldToMontgomeryPointer(
//     349182933258078050259523157531466844960159206018635835051506352504740558686861817108828677592491126707070689617765n
//   ),
//   z: fieldToMontgomeryPointer(
//     2014259652617979319916491378628470402653466229654159696878746685217991800191041685122234338927930520199423341284592n
//   ),
// };
// let p2 = {
//   x: fieldToMontgomeryPointer(
//     746770582125826314230378982614477579559793821614404877924462323898093038599304955366687092961300889405196899156130n
//   ),
//   y: fieldToMontgomeryPointer(
//     965977510762565992007486797440735290892871732043763389194610852935542606391431307697342429659456484618131624743023n
//   ),
//   z: fieldToMontgomeryPointer(
//     2758577146807377746763397813752322139350195052447095567436437933957387506941327577817487190479897820041011691969267n
//   ),
// };

// let point1 = addProjectiveJs(toPoint(p1), toPoint(p2));
// // console.log(readField(p1.x), readField(p1.y));
// addAssignProjective(p1, p2);
// console.log({
//   x: fieldFromMontgomeryPointer(p1.x) === point1.x.value,
//   y: fieldFromMontgomeryPointer(p1.y) === point1.y.value,
//   z: fieldFromMontgomeryPointer(p1.z) === point1.z.value,
// });
// point1 = doubleProjectiveJs(toPoint(p1));
// doubleInPlaceProjective(p1);
// console.log({
//   x: fieldFromMontgomeryPointer(p1.x) === point1.x.value,
//   y: fieldFromMontgomeryPointer(p1.y) === point1.y.value,
//   z: fieldFromMontgomeryPointer(p1.z) === point1.z.value,
// });
