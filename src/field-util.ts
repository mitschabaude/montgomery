/**
 * some basic ff algorithms in js, to use in wasm builders and tests
 */
import { assert, bigintFromBytes, log2, randomBytes } from "./util.js";

export {
  createField,
  mod,
  modExp,
  modInverse,
  montgomeryParams,
  randomGenerators,
  randomField,
  randomFields,
};

function createField(p: bigint) {
  let roots = rootsOfUnity(p);

  let sizeInBits = log2(p);
  let sizeInBytes = Math.ceil(sizeInBits / 8);
  let sizeHighestByte = sizeInBits - 8 * (sizeInBytes - 1);
  let msbMask = (1 << sizeHighestByte) - 1;

  return {
    p,
    sizeInBits,
    sizeInBytes,
    roots,

    mod(x: bigint) {
      return mod(x, p);
    },
    equal(x: bigint, y: bigint) {
      return mod(x - y, p) === 0n;
    },

    add(x: bigint, y: bigint) {
      let z = x + y;
      return z >= p ? z - p : z;
    },
    sub(x: bigint, y: bigint) {
      let z = x - y;
      return z < 0n ? z + p : z;
    },
    neg(x: bigint) {
      return x === 0n ? 0n : p - x;
    },
    mul(x: bigint, y: bigint) {
      return mod(x * y, p);
    },
    inv(x: bigint) {
      return modInverse(x, p);
    },
    sqrt(x: bigint) {
      return sqrt(x, p, roots);
    },
    random() {
      return randomField(p, sizeInBytes, msbMask);
    },
  };
}

function mod(x: bigint, p: bigint) {
  x = x % p;
  return x < 0n ? x + p : x;
}

/**
 * Compute the montgomery radix R=2^K and number of limbs n
 * @param p modulus
 * @param w word size in bits
 */
function montgomeryParams(p: bigint, w: number) {
  // word size has to be <= 32, to be able to multiply 2 words as i64
  if (w > 32) {
    throw Error("word size has to be <= 32 for efficient multiplication");
  }
  // montgomery radix R should be R = 2^K > 2p,
  // where K is exactly divisible by the word size w
  // i.e., K = n*w, where n is the number of limbs our field elements are stored in
  let lengthP = log2(p);
  let minK = lengthP + 1; // want 2^K > 2p bc montgomery mult. is modulo 2p
  // number of limbs is smallest n such that K := n*w >= minK
  let n = Math.ceil(minK / w);
  let K = n * w;
  let R = 1n << BigInt(K);
  let wn = BigInt(w);
  return {
    n,
    K,
    R,
    wn,
    wordMax: (1n << wn) - 1n,
    lengthP,
    nPackedBytes: Math.ceil(lengthP / 8),
  };
}

function modExp(a: bigint, n: bigint, p: bigint) {
  a = mod(a, p);
  // this assumes that p is prime, so that a^(p-1) % p = 1
  n = mod(n, p - 1n);
  let x = 1n;
  for (; n > 0n; n >>= 1n) {
    if (n & 1n) x = mod(x * a, p);
    a = mod(a * a, p);
  }
  return x;
}

/**
 * Extended Euclidian algorithm
 *
 * Input: positive integers a, p
 * Output: d = gcd(a, p) and x, y satisfying ax + yp = d
 */
function egcd(a: bigint, p: bigint): [d: bigint, x: bigint, y: bigint] {
  // the algorithm below can assume a <= p
  if (a > p) {
    let [d, y, x] = egcd(p, a);
    return [d, x, y];
  }
  // https://en.wikipedia.org/wiki/Extended_Euclidean_algorithm#Pseudocode
  let [r0, r1] = [p, a];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    let quotient = r0 / r1; // bigint division, cuts off remainder
    [r0, r1] = [r1, r0 - quotient * r1];
    [s0, s1] = [s1, s0 - quotient * s1];
    [t0, t1] = [t1, t0 - quotient * t1];
  }
  let [d, y, x] = [r0, s0, t0];
  return [d, x, y];
}

/**
 * inverting with EGCD, 1/a in Z_p
 *
 * @param a
 * @param p
 * @returns 1/a (mod p)
 */
function modInverse(a: bigint, p: bigint) {
  if (a === 0n) throw Error("cannot invert 0");
  let [d, x, _y] = egcd(mod(a, p), p);
  if (d !== 1n) throw Error("inverting failed (no inverse)");
  return mod(x, p);
}

function rootsOfUnity(p: bigint) {
  // figure out the factorization p - 1 = 2^M * t
  let t = p - 1n;
  let M = 0;
  while ((t & 1n) === 0n) {
    t >>= 1n;
    M++;
  }

  // find z = non-square
  // start with 2 and increment until we find one
  let z = 2n;
  let t0 = (p - 1n) >> 1n;

  // Euler's criterion, test z^(p-1)/2 = 1
  while (modExp(z, t0, p) === 1n) z++;

  // roots of unity w = z^t, w^2, ..., w^(2^(M-1)) = -1
  let roots = Array<bigint>(M);
  roots[0] = modExp(z, t, p);

  for (let i = 0; i < M; i++) {
    roots[i + 1] = mod(roots[i] * roots[i], p);
  }

  return { t, M, roots };
}

function sqrt(
  x: bigint,
  p: bigint,
  { t, M, roots }: { t: bigint; M: number; roots: bigint[] }
) {
  if (x === 0n) return 0n;

  let i = M;
  let u = modExp(x, (t - 1n) / 2n, p); // u = x^(t-1)/2
  let sqrtx = mod(x * u, p); // sqrtx = x^(t+1)/2
  u = mod(u * sqrtx, p); // u = x^t

  while (true) {
    // if u === 1, we're done
    if (u === 1n) return sqrtx;

    // use repeated squaring to find the least i', 0 < i' < i, such that u^(2^i') = 1
    let i_ = 1;
    let s = mod(u * u, p);
    while (s !== 1n) {
      s = mod(s * s, p);
      i_++;
    }
    if (i === i_) return undefined; // no solution
    assert(i_ < i); // by construction
    i = i_;
    sqrtx = mod(sqrtx * roots[M - i - 1], p); // sqrtx *= b = w^(2^(S - i - 1))
    u = mod(u * roots[M - i], p); // u *= b^2
  }
}

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
