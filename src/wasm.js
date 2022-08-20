import { memory } from "./finite-field.wat.js";

export { readField, writeFieldInto, readFieldBytes, writeFieldBytes };

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
 * @returns
 */
function readFieldBytes(pointer) {
  let viewWasm = new DataView(memory.buffer, pointer, 96);
  let bytes = new Uint8Array(48);
  let viewOut = new DataView(bytes.buffer);
  for (let offset = 0; offset < 48; offset += 4) {
    let u32 = viewWasm.getUint32(offset * 2, true);
    viewOut.setUint32(offset, u32, true);
  }
  return bytes;
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

/**
 *
 * @param {number} pointer
 * @param {Uint8Array} bytes
 */
function writeFieldBytes(pointer, bytes) {
  let viewIn = new DataView(bytes.buffer);
  let viewWasm = new DataView(memory.buffer, pointer, 96);
  for (let offset = 0; offset < 48; offset += 4) {
    let u32 = viewIn.getUint32(offset, true);
    viewWasm.setUint32(offset * 2, u32, true);
  }
  return bytes;
}
