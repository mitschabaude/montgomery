import {
  add,
  multiply,
  reduce,
  subtract,
  makeOdd,
  copy,
} from "./src/finite-field.28.gen.wat.js";
import {
  p,
  constants,
  mod,
  inverse,
  square,
  randomBaseFieldx2,
  writeBigint,
  readBigInt,
  toMontgomery,
  getPointers,
} from "./src/finite-field.js";
import { webcrypto } from "node:crypto";
import { extractBitSlice } from "./src/util.js";
// web crypto compat
globalThis.crypto = webcrypto;

function toWasm(x0, x) {
  writeBigint(x, x0);
  toMontgomery(x);
}
function ofWasm([tmp], x) {
  multiply(tmp, x, constants.one);
  reduce(tmp);
  return readBigInt(tmp);
}

let [x, y, z, ...scratch] = getPointers(10);

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

for (let i = 0; i < 20; i++) {
  test();
}
