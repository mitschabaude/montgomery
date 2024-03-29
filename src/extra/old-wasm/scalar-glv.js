import { jsHelpers } from "./finite-field-generate.js";
import {
  decompose,
  fromPackedBytes,
  fromPackedBytesDouble,
  toPackedBytes,
  memory,
  dataOffset,
  extractBitSlice,
} from "./wasm/scalar-glv.wasm.js";
import { bigintFromBytes } from "../../util.js";
import { randomScalars } from "./finite-field-js.js";

export {
  writeBytesDouble as writeBytesScalar,
  readBytes as readBytesScalar,
  decompose,
  decomposeScalar,
  testDecomposeRandomScalar,
  scratchPtr,
  bytesPtr,
  fieldSizeBytes as scalarSize,
  packedSizeBytes as packedScalarSize,
  getPointer as getPointerScalar,
  resetPointers as resetPointersScalar,
  memory as memoryScalar,
  extractBitSlice,
  bitLength as scalarBitlength,
  writeBigintScalar,
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
const w = 30;
const wn = 30n;
const wordMax = (1n << 30n) - 1n;

let {
  fieldSizeBytes,
  packedSizeBytes,
  readBigInt,
  n,
  getStablePointers,
  getPointer,
  resetPointers,
  bitLength,
} = jsHelpers(lambda, w, {
  memory,
  toPackedBytes,
  fromPackedBytes,
  dataOffset,
});
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
 *
 * @param {Uint8Array} scalar
 * @returns {[Uint8Array, Uint8Array]}
 */
function decomposeScalar(scalar) {
  writeBytesDouble(scratchPtr, scalar);
  decompose(scratchPtr);
  let s0 = readBytes(bytesPtr, scratchPtr);
  let s1 = readBytes(bytesPtr2, scratchPtr + fieldSizeBytes);
  return [s0, s1];
}

/**
 * read field element into packed bytes representation
 * @param {number} bytesPtr pointer for packed representation
 * @param {number} pointer
 */
function readBytes(bytesPtr, pointer) {
  toPackedBytes(bytesPtr, pointer);
  return new Uint8Array(memory.buffer, bytesPtr, packedSizeBytes);
}

/**
 * @param {number} pointer
 * @param {Uint8Array} bytes
 */
function writeBytesDouble(pointer, bytes) {
  let arr = new Uint8Array(memory.buffer, bytesPtr, 2 * 4 * n);
  arr.fill(0);
  arr.set(bytes);
  fromPackedBytesDouble(pointer, bytesPtr);
}

/**
 * @param {number} x
 */
function readBigintDouble(x) {
  let x0 = readBigInt(x);
  let x1 = readBigInt(x + fieldSizeBytes);
  return x0 + 2n ** BigInt(n * w) * x1;
}

/**
 *
 * @param {number} x
 * @param {bigint} x0
 */
function writeBigintScalar(x, x0) {
  let arr = new Uint32Array(memory.buffer, x, 2 * n);
  for (let i = 0; i < 2 * n; i++) {
    arr[i] = Number(x0 & wordMax);
    x0 >>= wn;
  }
}
