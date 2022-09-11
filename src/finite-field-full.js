import {
  add,
  benchAdd,
  benchMultiply,
  benchSubtract,
  finiteFieldHelpers,
  makeOdd,
  moduleWithMemory,
  montgomeryParams,
  multiply,
  reduce,
  subtract,
} from "./finite-field-generate";
import { interpretWat, Writer } from "./wasm-generate";

/**
 *
 * @param {bigint} p
 * @param {number} w
 */
async function createArithmetic(p, w, { fromCompiled = true } = {}) {
  let wasm;
  if (fromCompiled) {
    wasm = (await import(`finite-field.${w}.gen.wat.js`)).exports;
  } else {
    wasm = createFiniteFieldWasm(p, w);
  }
  let {
    memory,
    multiply,
    add,
    addNoReduce,
    subtract,
    subtractNoReduce,
    reduce,
    isEqual,
    isZero,
    isGreater,
    makeOdd,
    shiftByWord,
  } = wasm;

  /**
   *
   * @param {number[]} scratchSpace
   * @param {number} ainv
   * @param {number} a0
   */
  function modInverseMontgomery(scratchSpace, r, a) {
    if (isZero(a)) throw Error("cannot invert 0");
    reduce(a);
    let k = almostInverseMontgomery(scratchSpace, r, a);
    // TODO: negation -- special case which is simpler
    // don't have to reduce r here, because it's already < p
    // reduceInPlace(r);
    subtractNoReduce(r, field.legs.p, r);

    // mutliply by 2**(2n - k), where n = 381 = bit length of p
    // TODO: efficient multiplication by power-of-2?
    // we use k+1 here because that's the valuethe theory is about:
    // n <= k+1 <= 2n, so that 0 <= 2n-(k+1) <= n, so that
    // 1 <= 2**(2n-(k+1)) <= 2**n < 2p
    // (in practice, k seems to be normally distributed around ~1.5n and never reach either n or 2n)
    let l = 2 * 381 - (k + 1);
    let [r1] = scratchSpace;
    let r1_ = new BigUint64Array(12);
    r1_[l >> 5] = 1n << BigInt(l % 32);
    writeFieldInto(r1, r1_);
    multiply(r, r, r1);
    multiply(r, r, field.legs.R2mod128);
  }

  // this is modified from the algorithms in papers in that it
  // * returns k-1 instead of k
  // * returns r < p without unconditionally
  // * allows to batch left- / right-shifts
  function almostInverseMontgomery([u, v, s], r, a) {
    // u = p, v = a, r = 0, s = 1
    storeFieldIn(u, field.legs.p);
    storeFieldIn(v, a);
    storeFieldIn(r, field.legs.zero);
    storeFieldIn(s, field.legs.one);
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

  return {
    modInverseMontgomery,
  };
}

/**
 *
 * @param {bigint} p
 * @param {number} w
 */
async function createFiniteFieldWasm(p, w, { withBenchmarks = false } = {}) {
  let { n } = montgomeryParams(p, w);
  let writer = Writer();
  moduleWithMemory(
    writer,
    `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
    () => {
      multiply(writer, p, w);

      add(writer, p, w);
      subtract(writer, p, w);

      reduce(writer, p, w);
      makeOdd(writer, p, w);
      finiteFieldHelpers(writer, p, w);

      if (withBenchmarks) {
        benchMultiply(writer);
        benchAdd(writer);
        benchSubtract(writer);
      }
    }
  );
  let wasm = await interpretWat(writer);
  return { wasm, writer };
}
