// run with ts-node-esm
import { F } from "../new-wasm/ff-bls12.js";
import {
  glv,
  getPointerScalar,
  testDecomposeRandomScalar,
  writeBytesScalar,
} from "../new-wasm/glv-bls12.js";
import { webcrypto } from "node:crypto";
import { extractBitSlice as extractBitSliceJS } from "../util.js";
import { mod, modInverse, randomBaseFieldx2 } from "../finite-field-js.js";

// web crypto compat
if (Number(process.version.slice(1, 3)) < 19)
  (globalThis as any).crypto = webcrypto;

const { p } = F;

function toWasm(x0: bigint, x: number) {
  F.writeBigint(x, x0);
  F.toMontgomery(x);
}
function ofWasm([tmp]: number[], x: number) {
  F.multiply(tmp, x, F.constants.one);
  F.reduce(tmp);
  return mod(F.readBigint(tmp), p);
}

let [x, y, z, z_hi, ...scratch] = F.getPointers(10);

let R = mod(1n << BigInt(F.w * F.n), p);
let Rinv = modInverse(R, p);

function test() {
  let x0 = randomBaseFieldx2();
  let y0 = randomBaseFieldx2();
  toWasm(x0, x);
  toWasm(y0, y);

  // multiply
  let z0 = mod(x0 * y0, p);
  F.multiply(z, x, y);
  let z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");
  z0 = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn; // test overflow resistance
  toWasm(z0, z);
  z0 = mod(z0 * z0, p);
  F.multiply(z, z, z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("multiply");

  // square
  z0 = mod(x0 * x0, p);
  F.square(z, x);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("square");

  // leftShift
  let k = 97;
  z0 = 1n << BigInt(k);
  // computes R^2 * 2^k / R = 2^k R, which is 2^k in montgomery form
  F.leftShift(z, F.constants.R2, k);
  z1 = ofWasm(scratch, z);
  if (z1 !== z0) throw Error("leftShift");

  // add
  z0 = mod(x0 + y0, p);
  F.add(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("add");

  // subtract
  z0 = mod(x0 - y0, p);
  F.subtract(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("subtract");

  // subtract plus 2p
  z0 = mod(x0 - y0, p);
  F.subtractPositive(z, x, y);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("subtract");

  // reduceInPlace
  z0 = x0 >= p ? x0 - p : x0;
  F.copy(z, x);
  F.reduce(z);
  z1 = ofWasm(scratch, z);
  if (z0 !== z1) throw Error("reduceInPlace");

  // isEqual
  if (F.isEqual(x, x) !== 1) throw Error("isEqual");
  if (F.isEqual(x, y) !== 0) throw Error("isEqual");

  // inverse
  F.inverse(scratch[0], z, x);
  F.multiply(z, z, x);
  z1 = ofWasm(scratch, z);
  if (z1 !== 1n) throw Error("inverse");

  // makeOdd
  F.writeBigint(x, 5n << 120n);
  F.writeBigint(z, 3n);
  F.makeOdd(x, z);
  x0 = F.readBigint(x);
  z0 = F.readBigint(z);
  if (!(x0 === 5n && z0 === 3n << 120n)) throw Error("makeOdd");

  // extractBitSlice
  let arr = new Uint8Array([0b0010_0110, 0b1101_0101, 0b1111_1111]);
  let e = Error("extractBitSlice");
  if (extractBitSliceJS(arr, 2, 4) !== 0b10_01) throw e;
  if (extractBitSliceJS(arr, 0, 2) !== 0b10) throw e;
  if (extractBitSliceJS(arr, 0, 8) !== 0b0010_0110) throw e;
  if (extractBitSliceJS(arr, 3, 9) !== 0b0101_0010_0) throw e;
  if (extractBitSliceJS(arr, 8, 8) !== 0b1101_0101) throw e;
  if (extractBitSliceJS(arr, 5, 3 + 8 + 2) !== 0b11_1101_0101_001) throw e;
  if (extractBitSliceJS(arr, 16, 10) !== 0b1111_1111) throw e;

  // extractBitSlice (wasm)
  let s = getPointerScalar();
  writeBytesScalar(s, arr);
  const { extractBitSlice } = glv;
  e = Error("extractBitSlice (wasm)");
  if (extractBitSlice(s, 2, 4) !== 0b10_01) throw e;
  if (extractBitSlice(s, 0, 2) !== 0b10) throw e;
  if (extractBitSlice(s, 0, 8) !== 0b0010_0110) throw e;
  if (extractBitSlice(s, 3, 9) !== 0b0101_0010_0) throw e;
  if (extractBitSlice(s, 8, 8) !== 0b1101_0101) throw e;
  if (extractBitSlice(s, 5, 3 + 8 + 2) !== 0b11_1101_0101_001) throw e;
  if (extractBitSlice(s, 16, 10) !== 0b1111_1111) throw e;
}

for (let i = 0; i < 20; i++) {
  test();
}
for (let i = 0; i < 100; i++) {
  let ok = testDecomposeRandomScalar();
  if (!ok) throw Error("scalar decomposition");
}
