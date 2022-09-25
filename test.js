import {
  add,
  multiply,
  reduce,
  subtract,
  makeOdd,
  copy,
  isEqual,
  leftShift,
  square,
  squareSubtractSubtract,
} from "./src/finite-field.wat.js";
import {
  p,
  constants,
  mod,
  inverse,
  randomBaseFieldx2,
  writeBigint,
  readBigInt,
  toMontgomery,
  getPointers,
  w,
  n,
} from "./src/finite-field.js";
import { webcrypto } from "node:crypto";
import { extractBitSlice } from "./src/util.js";
import { batchInverseInPlace } from "./src/curve-affine.js";
import { modInverse } from "./src/finite-field-js.js";
// web crypto compat
globalThis.crypto = webcrypto;

function toWasm(x0, x) {
  writeBigint(x, x0);
  toMontgomery(x);
}
function ofWasm([tmp], x) {
  multiply(tmp, x, constants.one);
  reduce(tmp);
  return mod(readBigInt(tmp), p);
}

let [x, y, z, tmp, ...scratch] = getPointers(10);

let R = mod(1n << BigInt(w * n), p);
let Rinv = modInverse(R, p);

function test() {
  let x0 = randomBaseFieldx2();
  let y0 = randomBaseFieldx2();
  toWasm(x0, x);
  toWasm(y0, y);

  // multiply
  let z0 = mod(x0 * y0, p);
  multiply(z, x, y);
  let z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");
  z0 = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn; // test overflow resistance
  toWasm(z0, z);
  z0 = mod(z0 * z0, p);
  multiply(z, z, z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");

  // square
  z0 = mod(x0 * x0, p);
  square(z, x);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("square");

  // // squareSubtractSubtract
  // z0 = mod(x0 * x0 - y0 - y0, p);
  // squareSubtractSubtract(z, x, y, y);
  // z1 = ofWasm(scratch, z);
  // if (z0 !== z1) throw Error("squareSubtractSubtract");

  // leftShift
  let k = 97;
  z0 = 1n << BigInt(k);
  // computes R^2 * 2^k / R = 2^k R, which is 2^k in montgomery form
  leftShift(z, constants.R2, k);
  z1 = ofWasm(scratch, z);
  if (z1 !== z0) throw Error("leftShift");

  // add
  z0 = mod(x0 + y0, p);
  add(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("add");

  // subtract
  z0 = mod(x0 - y0, p);
  subtract(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("subtract");

  // reduceInPlace
  z0 = x0 >= p ? x0 - p : x0;
  copy(z, x);
  reduce(z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("reduceInPlace");

  // inverse
  inverse(scratch, z, x);
  multiply(z, z, x);
  z1 = ofWasm(scratch, z);
  if (z1 !== 1n) throw Error("inverse");

  // makeOdd
  writeBigint(x, 5n << 120n);
  writeBigint(z, 3n);
  makeOdd(x, z);
  x0 = readBigInt(x);
  z0 = readBigInt(z);
  if (!(x0 === 5n && z0 === 3n << 120n)) throw Error("makeOdd");

  // extractBitSlice
  let arr = new Uint8Array([0b0010_0110, 0b1101_0101, 0b1111_1111]);
  let e = Error("extractBitSlice");
  if (extractBitSlice(arr, 2, 4) !== 0b10_01) throw e;
  if (extractBitSlice(arr, 0, 2) !== 0b10) throw e;
  if (extractBitSlice(arr, 0, 8) !== 0b0010_0110) throw e;
  if (extractBitSlice(arr, 3, 9) !== 0b0101_0010_0) throw e;
  if (extractBitSlice(arr, 8, 8) !== 0b1101_0101) throw e;
  if (extractBitSlice(arr, 5, 3 + 8 + 2) !== 0b11_1101_0101_001) throw e;
  if (extractBitSlice(arr, 16, 10) !== 0b1111_1111) throw e;
}

function testBatchMontgomery() {
  let n = 100;
  let X = getPointers(n);
  let invX = getPointers(n);
  let scratch = getPointers(10);
  for (let i = 0; i < n; i++) {
    let x0 = randomBaseFieldx2();
    writeBigint(X[i], x0);
    // compute inverses normally
    inverse(scratch, invX[i], X[i]);
  }
  // compute inverses as batch
  let tmpX = getPointers(n);
  batchInverseInPlace(scratch, tmpX, X, n);

  // check that all inverses are equal
  for (let i = 0; i < n; i++) {
    if (!isEqual(X[i], invX[i])) throw Error("batch inverse");
    if (readBigInt(X[i]) !== readBigInt(invX[i])) throw Error("batch inverse");
  }
}

for (let i = 0; i < 20; i++) {
  test();
}

testBatchMontgomery();
