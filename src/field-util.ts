/**
 * some basic ff algorithms in js, to use in wasm builders and tests
 */
import { log2 } from "./util.js";

export { mod, modExp, modInverse, montgomeryParams };

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

function modExp(a: bigint, n: bigint, { p }: { p: bigint }) {
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
 * inverting with EGCD, 1/a in Z_p
 *
 * @param a
 * @param  p
 * @returns 1/a (mod p)
 */
function modInverse(a: bigint, p: bigint) {
  if (a === 0n) throw Error("cannot invert 0");
  a = mod(a, p);
  let b = p;
  let x = 0n;
  let y = 1n;
  let u = 1n;
  let v = 0n;
  while (a !== 0n) {
    let q = b / a;
    let r = mod(b, a);
    let m = x - u * q;
    let n = y - v * q;
    b = a;
    a = r;
    x = u;
    y = v;
    u = m;
    v = n;
  }
  if (b !== 1n) throw Error("inverting failed (no inverse)");
  return mod(x, p);
}
