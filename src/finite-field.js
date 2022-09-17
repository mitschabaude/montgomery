import { createFiniteField } from "./finite-field-generate.js";
import * as wasm from "./finite-field.wat.js";

export {
  mod,
  randomBaseField,
  randomBaseFieldx2,
  randomScalars,
  scalar,
} from "./finite-field-js.js";

export { p, toMontgomery, fromMontgomery };

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
let w = 28;

export {
  constants,
  multiply,
  reduce,
  inverse,
  sqrt,
  square,
  writeBigint,
  readBigInt,
  copy,
  getPointers,
  resetPointers,
  readBytes,
  writeBytes,
  benchMultiply,
  benchInverse,
  n,
  memory,
  memoryBytes,
  getZeroPointers,
};
let {
  constants,
  multiply,
  reduce,
  inverse,
  sqrt,
  square,
  writeBigint,
  readBigInt,
  copy,
  getPointers,
  resetPointers,
  readBytes,
  writeBytes,
  // benchmarks
  benchMultiply,
  benchInverse,
  n,
  memory,
  getZeroPointers,
} = await createFiniteField(p, w, wasm);
let memoryBytes = new Uint8Array(memory.buffer);

/**
 *
 * @param {number} x
 */
function fromMontgomery(x) {
  multiply(x, x, constants.mg1);
  reduce(x);
}
/**
 *
 * @param {number} x
 */
function toMontgomery(x) {
  multiply(x, x, constants.R2);
}
