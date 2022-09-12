import { jsHelpers, montgomeryParams } from "./finite-field-generate.js";
import { mod } from "./finite-field-js.js";
import { log2 } from "./util.js";

export { createFiniteField };

/**
 *
 * @param {bigint} p
 * @param {number} w
 */
async function createFiniteField(p, w, wasm) {
  let {
    memory,
    multiply,
    addNoReduce,
    subtractNoReduce,
    reduce,
    isZero,
    isGreater,
    makeOdd,
    copy,
  } = wasm;
  let helpers = jsHelpers(p, w, memory);
  let { readBigInt, writeBigint, getPointers } = helpers;

  // put some constants in wasm memory
  let { n, K } = montgomeryParams(p, w);
  let N = log2(p);
  /**
   * @type {Record<string, number>}
   */
  let constants;
  {
    let [zero, one, p_, R2corr] = getPointers(4);
    writeBigint(zero, 0n);
    writeBigint(one, 1n);
    writeBigint(p_, p);
    let R2corr_ = mod(1n << BigInt(4 * K - 2 * N + 1), p);
    writeBigint(R2corr, R2corr_);
    constants = {
      zero,
      one,
      p: p_,
      R2corr,
    };
  }

  /**
   * montgomery inverse a 2^K -> a^(-1) 2^K (mod p)
   *
   * @param {number[]} scratchSpace
   * @param {number} ainv
   * @param {number} a0
   */
  function inverse(scratchSpace, r, a) {
    if (isZero(a)) throw Error("cannot invert 0");
    reduce(a);
    let k = almostInverseMontgomery(scratchSpace, r, a);
    // TODO: negation -- special case which is simpler
    // don't have to reduce r here, because it's already < p
    // reduceInPlace(r);
    if (false) {
      let kn = BigInt(k);
      let r0 = readBigInt(r);
      let a0 = readBigInt(a);
      console.log("r almost result", mod(r0 * a0 + 2n ** kn, p) === 0n);
    }
    subtractNoReduce(r, constants.p, r);

    // mutliply by 2^(2N - k), where N = 381 = bit length of p
    // TODO: efficient multiplication by power-of-2?
    // we use k+1 here because that's the value the theory is about:
    // n <= k+1 <= 2N, so that 0 <= 2N-(k+1) <= N, so that
    // 1 <= 2^(2N-(k+1)) <= 2^N < 2p
    // (in practice, k seems to be normally distributed around ~1.4N and never reach either N or 2N)
    let l = BigInt(2 * N - (k + 1));
    let [twoL] = scratchSpace;
    writeBigint(twoL, 1n << l);
    multiply(r, r, twoL); // * 2^(2N - (k+1)) * 2^(-K)

    // now we multiply by 2^(2(K + K-N) + 1))
    multiply(r, r, constants.R2corr); // * 2^(2K + 2(K-n) + 1) * 2^(-K)
    // = * 2 ^ (2n - k - 1 + 2(K-n) + 1)) = 2^(2*K - k)
    // ^^^ transforms (a * 2^K)^(-1)*2^k = a^(-1) 2^(-K+k)
    //     to a^(-1) 2^(-K+k + 2K -k) = a^(-1) 2^K = the montgomery representation of a^(-1)
  }

  // this is modified from the algorithms in papers in that it
  // * returns k-1 instead of k
  // * returns r < p without unconditionally
  // * allows to batch left- / right-shifts
  function almostInverseMontgomery([u, v, s], r, a) {
    // u = p, v = a, r = 0, s = 1
    copy(u, constants.p);
    copy(v, a);
    copy(r, constants.zero);
    copy(s, constants.one);
    let k = 0;
    for (; !isZero(v); ) {
      k += makeOdd(u, s);
      k += makeOdd(v, r);
      if (isGreater(u, v)) {
        subtractNoReduce(u, u, v);
        addNoReduce(r, r, s);
      } else {
        subtractNoReduce(v, v, u);
        addNoReduce(s, r, s);
      }
    }
    // TODO: this works without r << 1 at the end because k is also not incremented
    // so the invariant a*r = 2^k (mod p) is still true with a factor 2 less on both sides
    return k;
  }

  // TODO
  function square(z, x) {
    multiply(z, x, x);
  }

  return { ...wasm, ...helpers, constants, inverse, square };
}
