import { assert, mapRange } from "./util.js";
import type { WasmFunctions } from "./types.js";
import type { FieldWithMultiply } from "./wasm/multiply-montgomery.js";
import type { MemoryHelpers } from "./wasm/memory-helpers.js";
import { Func, i32 } from "wasmati";
import { THREADS, thread } from "./threads/threads.js";

export { createSqrt };

function createSqrt(
  { p }: { p: bigint },
  wasm: WasmField,
  helpers: MemoryHelpers,
  constants: {
    zero: number;
    mg1: number;
    mg2: number;
  }
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
  let M = 0;
  while ((t & 1n) === 0n) {
    t >>= 1n;
    M++;
  }
  let t0 = (p - 1n) >> 1n;
  let t1_ = (t - 1n) / 2n;
  let [t1] = helpers.local.getStablePointers(1);
  helpers.writeBigint(t1, t1_);

  // find z = non square
  // start with z = 2
  let [z, tmp, ...scratch] = helpers.local.getPointers(5);
  wasm.copy(z, constants.mg2);

  while (true) {
    // Euler's criterion, test z^(p-1)/2 = 1
    pow(scratch, tmp, z, t0);
    wasm.reduce(tmp);
    let isSquare = wasm.isEqual(tmp, constants.mg1);
    if (!isSquare) break;
    // z++
    wasm.add(z, z, constants.mg1);
  }

  // roots of unity w = z^t, w^2, ..., w^(2^(M-1)) = -1
  let roots = helpers.local.getStablePointers(M);
  pow(scratch, roots[0], z, t);
  for (let i = 1; i < M; i++) {
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
    let i = M;
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
      wasm.multiply(sqrtx, sqrtx, roots[M - i - 1]); // sqrtx *= b = w^(2^(S - i - 1))
      wasm.multiply(u, u, roots[M - i]); // u *= b^2
    }
  }

  // TODO
  if (M <= 4 || THREADS > 1) return { sqrt, t, roots };

  // sqrt implementation that speeds up the discrete log part by caching more roots of unity
  // after Daniel Bernstein, http://cr.yp.to/papers/sqroot.pdf

  // parameters for windowed representation of exponents in roots subgroup

  let c = Math.min(4, M); // window/limb size
  let L = 1 << c;
  let N = Math.ceil(M / c); // number of windows/limbs

  // precomputation

  // w_ij = w^(-j*2^(ic)) for i=0,...,N-1 and j=0,...,L-1 = 2^c-1
  let inverseRoots = mapRange(N, () => helpers.getStablePointers(L));
  // v_j = w^(j*2^((N-1)c)), j=0,...,L-1 = all Lth roots
  // TODO: this assumes tnat window size exactly divides M, i.e. M = Nc. if it doesn't,
  // LthRoots[j] = w^(2^(j(N-1)c)) will actually be 2^(M-(N-1)c)th roots and won't be L unique values
  let LthRoots = helpers.getStablePointers(L);

  // w00 = 1, w_01 = w^(-1)
  wasm.copy(inverseRoots[0][0], constants.mg1);
  wasm.inverse(tmp, inverseRoots[0][1], roots[0]);
  // v0 = 1, start computing v1
  wasm.copy(LthRoots[0], constants.mg1);
  wasm.copy(LthRoots[1], roots[0]);

  // compute w_i0 = 1 and w_i1 = w^(-2^ic)
  for (let i = 1; i < N; i++) {
    wasm.copy(inverseRoots[i][0], constants.mg1);

    // square w^(-2^((i-1)c)) c times to get w^(-2^(ic))
    wasm.square(inverseRoots[i][1], inverseRoots[i - 1][1]);
    wasm.square(LthRoots[1], LthRoots[1]);
    for (let j = 1; j < c; j++) {
      wasm.square(inverseRoots[i][1], inverseRoots[i][1]);
      wasm.square(LthRoots[1], LthRoots[1]);
    }
  }
  // compute w_ij, j>2, with w_ij = w_i1 * w_i(j-1)
  for (let i = 0; i < N; i++) {
    for (let j = 2; j < L; j++) {
      wasm.multiply(
        inverseRoots[i][j],
        inverseRoots[i][1],
        inverseRoots[i][j - 1]
      );
    }
  }
  // vj, j>2
  for (let j = 2; j < L; j++) {
    wasm.multiply(LthRoots[j], LthRoots[1], LthRoots[j - 1]);
  }
  // build a lookup table mapping the lowest limb of v_j to j
  let LthRootLookup: Record<number, number> = {};
  let view = new DataView(helpers.memoryBytes.buffer);

  for (let j = 0; j < L; j++) {
    let low = view.getInt32(LthRoots[j], true);
    LthRootLookup[low] = j;
  }
  // assert that all the Lth roots have different low limbs (they should be ~random)
  // console.log(LthRootLookup);
  if (Object.keys(LthRootLookup).length !== L) {
    // console.warn("can't use fastSqrt, Lth roots have collisions");
    return { sqrt, t, roots };
  }

  // lth root v_j --> j
  function lookupLthRoot(ptr: number) {
    return LthRootLookup[view.getInt32(ptr, true)];
  }
  // scratch pointers that we use as RHS
  let rhs = helpers.getStablePointers(N);
  let solutionDigits = Array<number>(N).fill(0);

  /**
   * square root, sqrtx^2 === x mod p
   *
   * returns boolean that indicates whether the square root exists
   *
   * can use the same pointer for sqrtx and x
   *
   * Algorithm: Tonelli-Shanks optimized by Daniel Bernstein, http://cr.yp.to/papers/sqroot.pdf
   * Optimization consists of cashing roots of 1 to speed up the discrete log part.
   * This makes the exponentation x^(t-1)/2 at the beginning by far the dominant part (~80%).
   */
  function fastSqrt([u, scratch]: number[], sqrtx: number, x: number) {
    if (wasm.isZero(x)) {
      wasm.copy(sqrtx, constants.zero);
      return true;
    }
    // t1 is (t-1)/2, where t is the odd factor in p-1
    wasm.exp(scratch, u, x, t1); // u = x^((t-1)/2)
    wasm.multiply(sqrtx, u, x); // sqrtx = x^((t+1)/2) = u * x
    wasm.multiply(u, u, sqrtx); // u = x^t = x^((t-1)/2) * x^((t+1)/2) = u * sqrtx

    // we know that x^t is a 2^Mth root of 1, so u = x^t = w^e
    // e is even <==> x is a square
    // the goal is to find e and then compute sqrtx =  x^((t+1)/2)w^(-e/2), so that
    // sqrtx^2 = x^(1 + t)w^(-e) = x w^e w^(-e) = x

    // to find e, we write it as
    // e = sum_j e_j 2^(jc)
    // this leads to an upper triangle system of equations in the exponent (multiplying by 2^(ic))
    // sum_{j=0}^{N-1-i} e_j 2^((i+j)c) = 2^(ic) e

    // step 1: compute rhs 2^(ic)e, i=0,...,N-1, with (N-1)c squarings
    wasm.copy(rhs[0], u);
    for (let i = 1; i < N; i++) {
      // square c times to go from 2^((i-1)c)e to 2^(ic)e in the exponent
      wasm.square(rhs[i], rhs[i - 1]);
      for (let j = 1; j < c; j++) {
        wasm.square(rhs[i], rhs[i]);
      }
    }

    // step 2: solve the equations for 2^((N-1)c)e_(N-1-i), from bottom to top, in N(N-1)/2 muls
    // at each iteration, look up the digit e_i in our table

    // look up e_0 from 2^((N-1)c)e_0 and return early if it's odd (<=> there is no square root)
    solutionDigits[0] = lookupLthRoot(rhs[N - 1]);
    if (solutionDigits[0] & 1) return false;

    for (let i = N - 2; i >= 0; i--) {
      // 2^((N-1)c)e_(N-1-i) = 2^(ic)e + sum_{j=0}^{N-2-i} (-e_j 2^((i+j)c))
      let solution = rhs[i];
      for (let j = 0; j < N - 1 - i; j++) {
        // add precomputed number -e_j 2^((i+j)c) ~= w_{i+j}{e_j} in the exponent
        let ej = solutionDigits[j];
        wasm.multiply(solution, solution, inverseRoots[i + j][ej]);
      }
      // look up solution and store
      solutionDigits[N - 1 - i] = lookupLthRoot(solution);
    }

    // step 3: compute e/2 by shifting down each digit e_i by 1 bit
    solutionDigits[0] >>= 1;
    for (let i = 1; i < N; i++) {
      solutionDigits[i - 1] |= (solutionDigits[i] & 1) << (c - 1);
      solutionDigits[i] >>= 1;
    }

    // step 4: multiply sqrtx by w^(-e/2)
    for (let i = 0; i < N; i++) {
      // add precomputed number -e_i 2^(ic) ~= w_{i}{e_i} in the exponent
      let ei = solutionDigits[i];
      wasm.multiply(sqrtx, sqrtx, inverseRoots[i][ei]);
    }
    return true;
  }

  return { sqrt: fastSqrt, t, roots };
}

// wasm API we need

type WasmField = WasmFunctions<
  FieldWithMultiply,
  "copy" | "add" | "reduce" | "isEqual" | "isZero" | "multiply" | "square"
> &
  WasmFunctions<{
    exp: Func<[i32, i32, i32, i32], []>;
    inverse: Func<[i32, i32, i32], []>;
  }>;
