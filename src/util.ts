export {
  bigintFromBytes,
  bigintToBytes,
  bigUint64toUint8Array,
  uint8ArrayToBigUint64,
  bigintToBits,
  bigintToLimbs,
  bigintFromLimbs,
  logBytesAsBigint,
  log2,
  extractBitSlice,
  mapRange,
  randomBytes,
  bytesEqual,
};

function bigintFromBytes(bytes: Uint8Array) {
  let x = 0n;
  let bitPosition = 0n;
  for (var i = 0; i < bytes.length; i++) {
    x += BigInt(bytes[i]) << bitPosition;
    bitPosition += 8n;
  }
  return x;
}

function bigintToBytes(x: bigint, length: number | undefined): Uint8Array {
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

function bigUint64toUint8Array(x: BigUint64Array): Uint8Array {
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

function uint8ArrayToBigUint64(x8: Uint8Array): BigUint64Array {
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

function bigintToBits(x: bigint, bitLength: number): boolean[] {
  let bits = Array(bitLength || 0);
  for (let i = 0; bitLength ? i < bitLength : x > 0n; i++) {
    bits[i] = !!Number(x & 1n);
    x >>= 1n;
  }
  return bits;
}

/**
 * Split bigint into n w-bit limbs, which are also bigints
 * @param x0
 * @param w word size
 * @param n number of limbs
 */
function bigintToLimbs(x0: bigint, w: number, n: number) {
  /**
   * @type {bigint[]}
   */
  let limbs: bigint[] = Array(n);
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  for (let i = 0; i < n; i++) {
    limbs[i] = x0 & wordMax;
    x0 >>= wn;
  }
  return limbs;
}

function bigintFromLimbs(x: BigUint64Array, w: number, n: number) {
  let wn = BigInt(w);
  let x0 = x[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    x0 = x[i] + (x0 << wn);
  }
  return x0;
}

function logBytesAsBigint(bytes: Uint8Array) {
  let x = bigintFromBytes(bytes);
  console.log(x);
}

/**
 * ceil(log2(n))
 * = smallest k such that n <= 2^k
 */
function log2(n: number | bigint) {
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
function extractBitSlice(
  bytes: Uint8Array,
  startBit: number,
  bitLength: number
) {
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

function randomBytes(n: number) {
  let arr = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    let m = Math.min(n - i, 65536);
    globalThis.crypto.getRandomValues(arr.subarray(i, i + m));
  }
  return arr;
}

function mapRange<T>(n: number, callback: (i: number) => T) {
  return Array(n)
    .fill(0)
    .map((_, i) => callback(i));
}

function bytesEqual(b1: Uint8Array, b2: Uint8Array) {
  if (b1.length !== b2.length) return false;
  for (let i = 0; i < b1.length; i++) {
    if (b1[i] !== b2[i]) return false;
  }
  return true;
}