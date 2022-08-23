import {
  add,
  multiply,
  reduceInPlace,
  storeFieldIn,
  subtract,
  countTrailingZeroes,
  shiftByWord,
  makeOdd,
} from "./src/finite-field.wat.js";
import {
  field,
  fieldFromUint64Array,
  fieldToUint64Array,
  leftShiftInPlace,
  mod,
  modInverseMontgomery,
  randomBaseField,
  rightShiftInPlace,
} from "./src/finite-field.js";
import { getScratchSpace } from "./src/curve.js";
import { readField, writeFieldInto } from "./src/wasm.js";
import { webcrypto } from "node:crypto";
import { extractBitSlice } from "./src/util.js";
// web crypto compat
globalThis.crypto = webcrypto;

let { p, toWasm, ofWasm } = field;

let [x, y, z, ...scratch] = getScratchSpace(10);

function test() {
  let x0 = randomBaseField() + randomBaseField();
  let y0 = randomBaseField() + randomBaseField();
  toWasm(x0, x);
  toWasm(y0, y);

  // multiply
  let z0 = mod(x0 * y0, p);
  multiply(z, x, y);
  let z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");

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
  storeFieldIn(z, x);
  reduceInPlace(z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("reduceInPlace");

  // inverse
  modInverseMontgomery(scratch, z, x);
  multiply(z, z, x);
  z1 = ofWasm(scratch, z);
  if (z1 !== 1n) throw Error("inverse");

  // right shift
  storeFieldIn(z, x);
  z0 = fieldFromUint64Array(readField(z));
  rightShiftInPlace(z, 27);
  z0 >>= 27n;
  z1 = fieldFromUint64Array(readField(z));
  if (z0 !== z1) throw Error("rightShiftInPlace");

  // left shift
  writeFieldInto(z, fieldToUint64Array(2934n));
  z0 = fieldFromUint64Array(readField(z));
  leftShiftInPlace(z, 28);
  z0 <<= 28n;
  z1 = fieldFromUint64Array(readField(z));
  if (z0 !== z1) throw Error("leftShiftInPlace");

  // countTrailingZeroes
  let kTarget = 120;
  writeFieldInto(z, fieldToUint64Array(1n << BigInt(kTarget)));
  let k = countTrailingZeroes(z);
  if (k !== kTarget) throw Error("countTrailingZeroes");

  // shiftByWord
  writeFieldInto(x, fieldToUint64Array(1n << 120n));
  writeFieldInto(z, fieldToUint64Array(1n));
  shiftByWord(x, z);
  if (countTrailingZeroes(x) !== 120 - 32) throw Error("shiftByWord");
  if (countTrailingZeroes(z) !== 32) throw Error("shiftByWord");

  // makeOdd
  writeFieldInto(x, fieldToUint64Array(5n << 120n));
  writeFieldInto(z, fieldToUint64Array(3n));
  makeOdd(x, z);
  x0 = fieldFromUint64Array(readField(x));
  z0 = fieldFromUint64Array(readField(z));
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
