/**
 * some basic ff algorithms in js, to use in wasm builders and tests
 */
import { log2 } from "../util.js";

export { mod, montgomeryParams };

function mod(x: bigint, p: bigint) {
  x = x % p;
  return x < 0n ? x + p : x;
}

/**
 * Compute the montgomery radix R=2^K and number of limbs n
 * @param p modulus
 * @param w word size in bits
 */
function montgomeryParams(p: bigint, w: number, minExtraBits = 2) {
  // word size has to be <= 32, to be able to multiply 2 words as i64
  if (w > 32) {
    throw Error("word size has to be <= 32 for efficient multiplication");
  }
  // montgomery radix R should be R = 2^K > 2p,
  // where K is exactly divisible by the word size w
  // i.e., K = n*w, where n is the number of limbs our field elements are stored in
  let lengthP = log2(p);
  let minK = lengthP + minExtraBits; // want 2^K > 2p or 4p for some algorithms
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
