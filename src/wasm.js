import { memory } from "./finite-field.wat.js";

export { readField, writeFieldInto };

/**
 *
 * @param {number} pointer
 * @returns
 */
function readField(pointer) {
  return new BigUint64Array(memory.buffer.slice(pointer, pointer + 96));
}

/**
 *
 * @param {number} pointer
 * @param {BigUint64Array} x
 */
function writeFieldInto(pointer, x) {
  let copy = new BigUint64Array(memory.buffer, pointer, 12);
  copy.set(x);
}
