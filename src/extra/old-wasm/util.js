export {
  bigintFromBytes,
  bigintToBytes,
  bigintToBits,
  bigintToLegs,
  bigintFromLegs,
  logBytesAsBigint,
  log2,
  extractBitSlice,
  mapRange,
  randomBytes,
  bytesEqual,
};

/**
 *
 * @param {Uint8Array} bytes
 * @returns
 */
function bigintFromBytes(bytes) {
  let x = 0n;
  let bitPosition = 0n;
  for (var i = 0; i < bytes.length; i++) {
    x += BigInt(bytes[i]) << bitPosition;
    bitPosition += 8n;
  }
  return x;
}

/**
 *
 * @param {bigint} x
 * @param {number | undefined} length
 * @returns {Uint8Array}
 */
function bigintToBytes(x, length) {
  let bytes = [];
  for (; x > 0; x >>= 8n) {
    bytes.push(Number(x & 0xffn));
  }
  let array = new Uint8Array(bytes);
  if (length === undefined) return array;
  if (array.length > length)
    throw Error("bigint doesn't fit into" + length + " bytes.");
  let sizedArray = new Uint8Array(length);
  sizedArray.set(array);
  return sizedArray;
}

/**
 *
 * @param {bigint} x
 * @param {number} bitLength
 * @return {boolean[]}
 */
function bigintToBits(x, bitLength) {
  let bits = Array(bitLength || 0);
  for (let i = 0; bitLength ? i < bitLength : x > 0n; i++) {
    bits[i] = !!Number(x & 1n);
    x >>= 1n;
  }
  return bits;
}

/**
 * Split bigint into n w-bit legs, which are also bigints
 * @param {bigint} x0
 * @param {number} w word size
 * @param {number} n number of legs
 */
function bigintToLegs(x0, w, n) {
  /**
   * @type {bigint[]}
   */
  let legs = Array(n);
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  for (let i = 0; i < n; i++) {
    legs[i] = x0 & wordMax;
    x0 >>= wn;
  }
  return legs;
}

/**
 *
 * @param {BigUint64Array} x
 * @param {number} w
 * @param {number} n
 */
function bigintFromLegs(x, w, n) {
  let wn = BigInt(w);
  let x0 = x[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x0 = x[i] + (x0 << wn);
  }
  return x0;
}

function logBytesAsBigint(bytes) {
  let x = bigintFromBytes(bytes);
  console.log(x);
}

/**
 * ceil(log2(n))
 * = smallest k such that n <= 2^k
 * @param {number | bigint} n
 */
function log2(n) {
  if (typeof n === "number") n = BigInt(n);
  if (n === 1n) return 0;
  return (n - 1n).toString(2).length;
}

/**
 *
 * @param {Uint8Array} bytes
 * @param {number} startBit
 * @param {number} bitLength
 */
function extractBitSlice(bytes, startBit, bitLength) {
  let endBit = startBit + bitLength;
  let startByte = startBit >> 3;
  startBit -= startByte << 3;
  let endByte = endBit >> 3;
  endBit -= endByte << 3;
  if (startByte === endByte) {
    return ((bytes[startByte] || 0) & ((1 << endBit) - 1)) >> startBit;
  }
  let slice = (bytes[startByte] || 0) >> startBit;
  let position = 8 - startBit;
  for (let i = startByte + 1; i < endByte; i++) {
    slice += (bytes[i] || 0) << position;
    position += 8;
  }
  slice += ((bytes[endByte] || 0) & ((1 << endBit) - 1)) << position;
  return slice;
}

/**
 *
 * @param {number} n
 */
function randomBytes(n) {
  let arr = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    let m = Math.min(n - i, 65536);
    globalThis.crypto.getRandomValues(arr.subarray(i, i + m));
  }
  return arr;
}

/**
 * @template T
 * @param {number} n
 * @param {(i: number) => T} callback
 * @returns T[]
 */
function mapRange(n, callback) {
  return Array(n)
    .fill(0)
    .map((_, i) => callback(i));
}

function bytesEqual(b1, b2) {
  if (b1.length !== b2.length) return false;
  for (let i = 0; i < b1.length; i++) {
    if (b1[i] !== b2[i]) return false;
  }
  return true;
}
