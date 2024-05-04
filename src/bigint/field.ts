/**
 * some basic ff algorithms in js, to use in wasm builders and tests
 */
import { assert, log2 } from "../util.js";
import { randomField } from "./field-random.js";
import { mod } from "./field-util.js";

export { createField, BigintField, inverse, exp };

type BigintField = ReturnType<typeof createField>;

function createField(p: bigint) {
  let roots = rootsOfUnity(p);

  let sizeInBits = log2(p);
  let sizeInBytes = Math.ceil(sizeInBits / 8);
  let sizeHighestByte = sizeInBits - 8 * (sizeInBytes - 1);
  let msbMask = (1 << sizeHighestByte) - 1;

  return {
    p,
    modulus: p,
    sizeInBits,
    sizeInBytes,

    roots: roots.roots,
    t: roots.t,
    M: roots.M,

    mod(x: bigint) {
      return mod(x, p);
    },
    isEqual(x: bigint, y: bigint) {
      return mod(x - y, p) === 0n;
    },

    add(x: bigint, y: bigint) {
      let z = x + y;
      return z >= p ? z - p : z;
    },
    subtract(x: bigint, y: bigint) {
      let z = x - y;
      return z < 0n ? z + p : z;
    },
    negate(x: bigint) {
      return x === 0n ? 0n : p - x;
    },
    multiply(x: bigint, y: bigint) {
      return mod(x * y, p);
    },
    square(x: bigint) {
      return mod(x * x, p);
    },
    inverse(x: bigint) {
      return inverse(x, p);
    },
    exp(x: bigint, n: bigint) {
      return exp(x, n, p);
    },
    isSquare(x: bigint) {
      return mod(x, p) === 0n || exp(x, (p - 1n) / 2n, p) === 1n;
    },
    sqrt(x: bigint) {
      return sqrt(x, p, roots);
    },
    random() {
      return randomField(p, sizeInBytes, msbMask);
    },
  };
}

// FINITE FIELD ALGORITHMS

/**
 * Finite field exponentiation, x^n mod p.
 * Uses multiply-and-square
 */
function exp(x: bigint, n: bigint, p: bigint) {
  x = mod(x, p);
  let u = 1n;
  for (; n > 0n; n >>= 1n) {
    if (n & 1n) u = mod(u * x, p);
    x = mod(x * x, p);
  }
  return u;
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
 * Finite field inverse 1/x mod p, using EGCD
 */
function inverse(x: bigint, p: bigint) {
  if (x === 0n) throw Error("cannot invert 0");
  let [d, xInv, _y] = egcd(mod(x, p), p);
  if (d !== 1n) throw Error("inverting failed (no inverse)");
  return mod(xInv, p);
}

/**
 * Tonelli-Shanks algorithm for finding square roots in Z_p
 */
function sqrt(
  x: bigint,
  p: bigint,
  { t, M, roots }: { t: bigint; M: number; roots: bigint[] }
) {
  if (x === 0n) return 0n;

  let i = M;
  let u = exp(x, (t - 1n) / 2n, p); // u = x^(t-1)/2
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
 * Precomputation for {@link sqrt}
 */
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
  while (exp(z, t0, p) === 1n) z++;

  // roots of unity w = z^t, w^2, ..., w^(2^(M-1)) = -1
  let roots = Array<bigint>(M);
  roots[0] = exp(z, t, p);

  for (let i = 0; i < M; i++) {
    roots[i + 1] = mod(roots[i] * roots[i], p);
  }

  return { t, M, roots };
}
