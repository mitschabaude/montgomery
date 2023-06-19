import { assert } from "./util.js";
import type { WasmFunctions } from "./types.js";
import type { FieldWithMultiply } from "./wasm/multiply-montgomery.js";
import type { MsmField } from "./field-msm.js";
import type { MemoryHelpers } from "./wasm/helpers.js";
import type { fieldExp } from "./wasm/exp.js";

export { createSqrt };

function createSqrt(
  { p }: FieldWithMultiply,
  wasm: WasmField,
  helpers: MemoryHelpers,
  constants: MsmField["constants"]
) {
  function pow(
    [scratch, n0]: number[],
    z: number,
    x: number,
    n: bigint | number
  ) {
    helpers.writeBigint(n0, BigInt(n));
    wasm.exp(scratch, z, x, n0);
  }

  // precomputed constants for tonelli-shanks
  let t = p - 1n;
  let S = 0;
  while ((t & 1n) === 0n) {
    t >>= 1n;
    S++;
  }
  let t0 = (p - 1n) >> 1n;
  let t1_ = (t - 1n) / 2n;
  let [t1] = helpers.getStablePointers(1);
  helpers.writeBigint(t1, t1_);

  // find z = non square
  // start with z = 2
  let [z, zp, ...scratch] = helpers.getPointers(5);
  wasm.copy(z, constants.mg2);

  while (true) {
    // Euler's criterion, test z^(p-1)/2 = 1
    pow(scratch, zp, z, t0);
    wasm.reduce(zp);
    let isSquare = wasm.isEqual(zp, constants.mg1);
    if (!isSquare) break;
    // z++
    wasm.add(z, z, constants.mg1);
  }

  // roots of unity w = z^t, w^2, ..., w^(2^(S-1)) = -1
  let roots = helpers.getStablePointers(S);
  pow(scratch, roots[0], z, t);
  for (let i = 1; i < S; i++) {
    wasm.square(roots[i], roots[i - 1]);
  }

  /**
   * square root, sqrtx^2 === x mod p
   *
   * returns boolean that indicates whether the square root exists
   *
   * can use the same pointer for sqrtx and x
   *
   * Algorithm: https://en.wikipedia.org/wiki/Tonelli-Shanks_algorithm#The_algorithm
   *
   * note: atm, the exponentiation x^(t-1)/2 takes about 2/3 of the time here (and seems hard to improve)
   * probably possible optimize the second part of the algorithm with more caching
   */
  function sqrt([u, s, scratch]: number[], sqrtx: number, x: number) {
    if (wasm.isZero(x)) {
      wasm.copy(sqrtx, constants.zero);
      return true;
    }
    let i = S;
    // t1 is (t-1)/2, where t is the odd factor in p-1
    wasm.exp(scratch, u, x, t1); // u = x^((t-1)/2)
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

  return { sqrt, t, roots };
}

// wasm API we need

type WasmField = WasmFunctions<
  FieldWithMultiply,
  "copy" | "add" | "reduce" | "isEqual" | "isZero" | "multiply" | "square"
> &
  WasmFunctions<{ exp: fieldExp }>;
