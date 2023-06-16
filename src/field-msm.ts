import type * as W from "wasmati"; // for type names
import { Module, memory } from "wasmati";
import { FieldWithArithmetic } from "./wasm/field-arithmetic.js";
import { fieldInverse } from "./wasm/inverse.js";
import { multiplyMontgomery } from "./wasm/multiply-montgomery.js";
import { ImplicitMemory } from "./wasm/wasm-util.js";
import { mod, montgomeryParams } from "./field-util.js";
import { curveOps } from "./wasm/curve.js";
import { memoryHelpers } from "./wasm/helpers.js";
import { fromPackedBytes, toPackedBytes } from "./wasm/field-helpers.js";
import { UnwrapPromise } from "./types.js";
import { assert } from "./util.js";

export { createMsmField, MsmField };

type MsmField = UnwrapPromise<ReturnType<typeof createMsmField>>;

async function createMsmField(p: bigint, beta: bigint, w: number) {
  let { K, R, lengthP: N, n, nPackedBytes } = montgomeryParams(p, w);

  let implicitMemory = new ImplicitMemory(memory({ min: 1 << 16 }));

  let Field_ = FieldWithArithmetic(p, w);
  let { multiply, square, leftShift } = multiplyMontgomery(p, w, {
    countMultiplications: false,
  });
  const Field = Object.assign(Field_, { multiply, square, leftShift });

  let { inverse, makeOdd, batchInverse } = fieldInverse(implicitMemory, Field);
  let { addAffine, endomorphism } = curveOps(
    implicitMemory,
    Field,
    inverse,
    beta
  );

  let {
    isEqual,
    isGreater,
    isZero,
    add,
    subtract,
    subtractPositive,
    reduce,
    copy,
  } = Field;

  let module = Module({
    exports: {
      ...implicitMemory.getExports(),
      // curve ops
      addAffine,
      endomorphism,
      // multiplication
      multiply,
      square,
      leftShift,
      // inverse
      inverse,
      makeOdd,
      batchInverse,
      // arithmetic
      add,
      subtract,
      subtractPositive,
      reduce,
      copy,
      // helpers
      isEqual,
      isGreater,
      isZero,
      fromPackedBytes: fromPackedBytes(w, n),
      toPackedBytes: toPackedBytes(w, n, nPackedBytes),
    },
  });

  let wasm = (await module.instantiate()).instance.exports;
  let helpers = memoryHelpers(p, w, wasm);

  // put some constants in wasm memory

  let constantsBigint = {
    zero: 0n,
    one: 1n,
    p,
    R: mod(R, p),
    R2: mod(R * R, p),
    R2corr: mod(1n << BigInt(4 * K - 2 * N + 1), p),
    // common numbers in montgomery representation
    mg1: mod(1n * R, p),
    mg2: mod(2n * R, p),
    mg4: mod(4n * R, p),
    mg8: mod(8n * R, p),
  };
  let constantsKeys = Object.keys(constantsBigint);
  let constantsPointers = helpers.getStablePointers(constantsKeys.length);

  let constants = Object.fromEntries(
    constantsKeys.map((key, i) => {
      let pointer = constantsPointers[i];
      helpers.writeBigint(
        pointer,
        constantsBigint[key as keyof typeof constantsBigint]
      );
      return [key, pointer];
    })
  ) as Record<keyof typeof constantsBigint, number>;

  function fromMontgomery(x: number) {
    wasm.multiply(x, x, constants.one);
    wasm.reduce(x);
  }
  function toMontgomery(x: number) {
    wasm.multiply(x, x, constants.R2);
  }

  let memoryBytes = new Uint8Array(wasm.memory.buffer);

  // higher level finite field algorithms

  /**
   * z = x^n mod p
   */
  function power(scratch: number, z: number, x: number, n: bigint | number) {
    n = BigInt(n);
    let x0 = scratch;
    wasm.copy(z, constants.mg1);
    wasm.copy(x0, x);
    const { multiply, square } = wasm;
    for (; n > 0n; n >>= 1n) {
      if (n & 1n) multiply(z, z, x0);
      square(x0, x0);
    }
  }

  // precomputed constants for tonelli-shanks
  let t = p - 1n;
  let S = 0;
  while ((t & 1n) === 0n) {
    t >>= 1n;
    S++;
  }
  let t0 = (p - 1n) >> 1n;

  // find z = non square
  // start with z = 2
  let [z] = helpers.getStablePointers(1);
  wasm.copy(z, constants.mg2);
  let z0 = 2;
  let scratch = helpers.getPointers(2);

  while (true) {
    // Euler's criterion, test z^(p-1)/2 = 1
    power(scratch[0], scratch[1], z, t0);
    wasm.reduce(scratch[1]);
    let isSquare = wasm.isEqual(scratch[1], constants.mg1);
    if (!isSquare) break;

    // z++
    z0++;
    wasm.add(z, z, constants.mg1);
  }

  // roots of unity w = z^t, w^2, ..., w^(2^(S-1)) = -1
  let roots = helpers.getStablePointers(S);
  power(scratch[0], roots[0], z, t);
  for (let i = 1; i < S; i++) {
    wasm.square(roots[i], roots[i - 1]);
  }

  let t1 = (t - 1n) / 2n;

  /**
   * square root, sqrtx^2 === x mod p
   *
   * returns boolean that indicates whether the square root exists
   *
   * can use the same pointer for sqrtx and x
   *
   * Algorithm: https://en.wikipedia.org/wiki/Tonelli-Shanks_algorithm#The_algorithm
   *
   * note: it's tempting to try to optimize the second part of the algorithm
   * with more caching and other tricks, but in fact the exponentiation u^(t-1)/2 dominates
   * the cost (~80%) and seems hard to improve
   */
  function sqrt([u, s, scratch]: number[], sqrtx: number, x: number) {
    if (wasm.isZero(x)) {
      wasm.copy(sqrtx, constants.zero);
      return true;
    }
    // t1 is (t-1)/2, where t is the odd factor in p-1
    let i = S;
    power(scratch, u, x, t1); // u = x^((t-1)/2)
    wasm.multiply(sqrtx, u, x); // sqrtx = x^((t+1)/2) = u * x
    wasm.multiply(u, u, sqrtx); // u = x^t = x^((t-1)/2) * x^((t+1)/2) = u * sqrtx

    while (true) {
      // if u === 1, we're done
      if (wasm.isEqual(u, constants.mg1)) return true;

      // use repeated squaring to find the least i', 0 < i' < i, such that u^(2^i') = 1
      let i_ = 1;
      wasm.square(s, u);
      while (!wasm.isEqual(s, constants.mg1)) {
        wasm.square(s, s);
        i_++;
      }
      if (i_ === i) return false; // no solution
      assert(i_ < i); // by construction
      i = i_;
      wasm.multiply(sqrtx, sqrtx, roots[S - i - 1]); // sqrtx *= b = w^(2^(S - i - 1))
      wasm.multiply(u, u, roots[S - i]); // u *= b^2
    }
  }

  return {
    p,
    w,
    t,
    ...wasm,
    /**
     * affine EC addition, G3 = G1 + G2
     *
     * assuming d = 1/(x2 - x1) is given, and inputs aren't zero, and x1 !== x2
     * (edge cases are handled one level higher, before batching)
     *
     * this supports addition with assignment where G3 === G1 (but not G3 === G2)
     * @param scratch
     * @param G3 (x3, y3)
     * @param G1 (x1, y1)
     * @param G2 (x2, y2)
     * @param d 1/(x2 - x1)
     */
    addAffine: wasm.addAffine,
    /**
     * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
     *
     * needs 3 fields of scratch space
     */
    inverse: wasm.inverse,
    ...helpers,
    constants,
    roots,
    memoryBytes,
    toMontgomery,
    fromMontgomery,
    power,
    sqrt,
    toBigint(x: number) {
      fromMontgomery(x);
      let x0 = helpers.readBigint(x);
      toMontgomery(x);
      return x0;
    },
  };
}
