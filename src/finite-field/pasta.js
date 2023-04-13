import { bigintFromBytes, randomBytes } from "../util.js";

export { p, q, nBits, nBytes, randomBaseField, randomBaseFieldx2 };

const p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001n;
const q = 0x40000000000000000000000000000000224698fc0994a8dd8c46eb2100000001n;

const nBits = 255;
const nBytes = 32;

/**
 * @returns {bigint}
 */
function randomBaseField() {
  while (true) {
    let bytes = randomBytes(nBytes);
    bytes[nBytes - 1] &= 0x3f;
    let x = bigintFromBytes(bytes);
    if (x < p) return x;
  }
}

/**
 * @returns {bigint}
 */
function randomBaseFieldx2() {
  while (true) {
    let bytes = randomBytes(nBytes);
    bytes[nBytes - 1] &= 0x1f;
    let x = bigintFromBytes(bytes);
    if (x < 2n * p) return x;
  }
}
