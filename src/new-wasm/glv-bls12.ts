import { Const, Module, global, memory } from "wasmati";
import { barrettReduction } from "./barrett.js";
import { glv } from "./glv.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";
import { randomScalars } from "../finite-field-js.js";
import { bigintFromBytes } from "../util.js";
import { jsHelpers, montgomeryParams } from "./helpers.js";
import {
  extractBitSlice,
  fromPackedBytes,
  toPackedBytes,
} from "./field-helpers.js";

export {
  glvWasm as glv,
  testDecomposeRandomScalar,
  getPointer as getPointerScalar,
  writeBytesDouble as writeBytesScalar,
};

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
let q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

// lambda**3 = 1 (mod q), beta**3 = 1 (mod p)
// (beta*x, y) = lambda * (x, y)
// (beta*x, -y) = (-lambda) * (x, y)
// where lambda = -z^2
// where z = 0xd201000000010000
let minusZ = 0xd201000000010000n;
let minusLambda1 = minusZ ** 2n;
let lambda1 = q - minusLambda1;
let beta1 =
  0x5f19672fdf76ce51ba69c6076a0f77eaddb3a93be6f89688de17d813620a00022e01fffffffefffen;
// a different solution is lambda2 = z^2 - 1
// might be better because we can use it directly instead of its negative
let lambda2 = minusZ ** 2n - 1n;
let beta2 =
  0x1a0111ea397fe699ec02408663d4de85aa0d857d89759ad4897d29650fb85f9b409427eb4f49fffd8bfd00000000aaacn;

const lambda = lambda2;
const w = 29;
const wn = BigInt(w);
const wordMax = (1n << wn) - 1n;
const { n, nPackedBytes } = montgomeryParams(lambda, w);

const { multiply } = multiplySchoolbook(lambda, w);
const { barrett } = barrettReduction(lambda, w, multiply);

const { decompose, decomposeNoMsb } = glv(q, lambda, w, barrett);

let module = Module({
  exports: {
    decompose,
    decomposeNoMsb,
    fromPackedBytes: fromPackedBytes(w, n),
    fromPackedBytesDouble: fromPackedBytes(w, 2 * n),
    toPackedBytes: toPackedBytes(w, n, nPackedBytes),
    extractBitSlice: extractBitSlice(w, n),
    memory: memory({ min: 1 << 10 }),
    dataOffset: global(Const.i32(0)),
  },
});

let m = await module.instantiate();
const glvWasm = m.instance.exports;

let {
  fieldSizeBytes,
  packedSizeBytes,
  readBigInt,
  getStablePointers,
  getPointer,
  resetPointers,
  bitLength,
  readBytes,
} = jsHelpers(lambda, w, glvWasm);

let [scratchPtr, , bytesPtr, bytesPtr2] = getStablePointers(5);

function testDecomposeRandomScalar() {
  let [scalar] = randomScalars(1);
  let scalar0 = bigintFromBytes(scalar);
  let [r, l] = decomposeScalar(scalar);
  let r0 = bigintFromBytes(r);
  let l0 = bigintFromBytes(l);
  let isCorrect = r0 + l0 * lambda === scalar0;
  return isCorrect;
}

/**
 * decompose scalar s = s0 + lambda*s1, where lambda is a cube root of 1
 *
 * WARNING: scalars are always decomposed into the same
 * bytes positions in wasm memory, so one decomposition overwrites the previous one
 */
function decomposeScalar(scalar: Uint8Array): [Uint8Array, Uint8Array] {
  writeBytesDouble(scratchPtr, scalar);
  glvWasm.decompose(scratchPtr);
  let s0 = readBytes([bytesPtr], scratchPtr);
  let s1 = readBytes([bytesPtr2], scratchPtr + fieldSizeBytes);
  return [s0, s1];
}

function writeBytesDouble(pointer: number, bytes: Uint8Array) {
  let arr = new Uint8Array(glvWasm.memory.buffer, bytesPtr, 2 * 4 * n);
  arr.fill(0);
  arr.set(bytes);
  glvWasm.fromPackedBytesDouble(pointer, bytesPtr);
}

function writeBigintScalar(x: number, x0: bigint) {
  let arr = new Uint32Array(glvWasm.memory.buffer, x, 2 * n);
  for (let i = 0; i < 2 * n; i++) {
    arr[i] = Number(x0 & wordMax);
    x0 >>= wn;
  }
}
