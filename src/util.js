export {
  bigintFromBytes,
  bigintToBytes,
  bigUint64toUint8Array,
  uint8ArrayToBigUint64,
  bigintToBits,
  bigintToLegs,
  logBytesAsBigint,
  log2,
  extractBitSlice,
};

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
  var bytes = [];
  for (; x > 0; x >>= 8n) {
    bytes.push(Number(x & 0xffn));
  }
  var array = new Uint8Array(bytes);
  if (length === undefined) return array;
  if (array.length > length)
    throw Error("bigint doesn't fit into" + length + " bytes.");
  var sizedArray = new Uint8Array(length);
  sizedArray.set(array);
  return sizedArray;
}

/**
 *
 * @param {BigUint64Array} x
 * @return {Uint8Array}
 */
function bigUint64toUint8Array(x) {
  let n = x.length * 8;
  let x8 = new Uint8Array(n);
  for (let i = 0; i < n; i += 8) {
    let bigint64 = x[i >> 3];
    for (let j = 0; j < 8; j++) {
      x8[i + j] = Number(bigint64 & 0xffn);
      bigint64 >>= 8n;
    }
  }
  return x8;
}

/**
 *
 * @param {Uint8Array} x8
 * @returns {BigUint64Array}
 */
function uint8ArrayToBigUint64(x8) {
  let n = x8.length;
  let x = new BigUint64Array(n >> 3);
  for (let i = 0; i < n; i += 8) {
    let bigint64 = 0n;
    let position = 0n;
    for (let j = 0; j < 8; j++) {
      bigint64 += BigInt(x8[i + j]) << position;
      position += 8n;
    }
    x[i >> 3] = bigint64;
  }
  return x;
}

/**
 *
 * @param {bigint} x
 * @param {number} bitLength
 * @return {boolean[]}
 */
function bigintToBits(x, bitLength) {
  let bits = Array(bitLength ?? 0);
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
function bigintToLegs(x, w, n) {
  let legs = Array(n);
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  for (let i = 0; i < n; i++) {
    legs[i] = x & wordMax;
    x >>= wn;
  }
  return legs;
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
    return ((bytes[startByte] ?? 0) & ((1 << endBit) - 1)) >> startBit;
  }
  let slice = (bytes[startByte] ?? 0) >> startBit;
  let position = 8 - startBit;
  for (let i = startByte + 1; i < endByte; i++) {
    slice += (bytes[i] ?? 0) << position;
    position += 8;
  }
  slice += ((bytes[endByte] ?? 0) & ((1 << endBit) - 1)) << position;
  return slice;
}
