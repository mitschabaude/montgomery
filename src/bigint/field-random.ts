import { bigintFromBytes, log2, randomBytes } from "../util.js";

export { randomField, randomFields, randomGenerators };

/**
 * Draw a random field element.
 *
 * More generally, this is suitable for generating numbers in the range [0, p)
 * for any p.
 *
 * - draws a random bigint in the interval [0, 2^(8*size)),
 *   where `size` is the size in bytes
 * - ANDs the most significant byte with `msbMask`,
 *   to get the result down to the range [0, 2^b) for some bit length `b < 8*size`
 * - returns if the result is smaller than `p`, redraws otherwise
 *
 * @param p modulus / max of range to draw from
 * @param size size of p in bytes (= rounded up integer)
 * @param msbMask bitmask to apply to the most significant byte, to set high bits to 0
 *
 * you can compute the parameters as follows:
 * ```
 * let sizeInBits = p.toString(2).length; // faster would be `Math.ceil(Math.log2(p + 1))`, but p is a bigint
 * let size = Math.ceil(sizeInBits / 8);
 * let sizeHighestByte = sizeInBits - 8*(size - 1);
 * let msbMask = (1 << sizeHighestByte) - 1;
 * ```
 */
function randomField(p: bigint, size: number, msbMask: number) {
  while (true) {
    let bytes = randomBytes(size);
    bytes[size - 1] &= msbMask;
    let x = bigintFromBytes(bytes);
    if (x < p) return x;
  }
}

/**
 * Draw random field elements. Same algorithms as {@link randomField}, but more efficient
 * because it uses a single call to native rng for all field elements combined
 */
function randomFields(n: number, p: bigint, size: number, msbMask: number) {
  let N = n * size * 2; // x2 to have buffer for rejected samples
  let bytes = randomBytes(N);
  let fields: bigint[] = Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    while (true) {
      if (j + size > N) {
        bytes = randomBytes(N);
        j = 0;
      }
      let bytes_ = bytes.subarray(j, j + size);
      bytes_[size - 1] &= msbMask;
      j += size;
      let x = bigintFromBytes(bytes_);
      if (x < p) {
        fields[i] = x;
        break;
      }
    }
  }
  return fields;
}

/**
 * commonly used random generators for field elements
 */
function randomGenerators(p: bigint) {
  let sizeInBits = log2(p);
  let sizeInBytes = Math.ceil(sizeInBits / 8);
  let nextPower256 = 1n << (8n * BigInt(sizeInBytes));
  let sizeHighestByte = sizeInBits - 8 * (sizeInBytes - 1);
  let msbMask = (1 << sizeHighestByte) - 1;
  let p2 = p * 2n;
  let msbMask2 = (1 << (sizeHighestByte + 1)) - 1;
  let p4 = p * 4n;
  let msbMask4 = (1 << (sizeHighestByte + 2)) - 1;
  return {
    randomField() {
      return randomField(p, sizeInBytes, msbMask);
    },
    randomFieldx2:
      p2 < nextPower256
        ? () => {
            return randomField(p2, sizeInBytes, msbMask2);
          }
        : () => {
            throw Error(`2*p exceeds ${sizeInBytes} bytes`);
          },
    randomFieldx4:
      p4 < nextPower256
        ? () => {
            return randomField(p4, sizeInBytes, msbMask4);
          }
        : () => {
            throw Error(`4*p exceeds ${sizeInBytes} bytes`);
          },
    randomFields(n: number) {
      return randomFields(n, p, sizeInBytes, msbMask);
    },
  };
}
