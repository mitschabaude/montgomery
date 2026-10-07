import {
  localArray,
  $,
  drop,
  func,
  i32,
  i64,
  local,
  type Local,
} from "wasmati";
import type { FieldBase } from "./field-base.ts";
import { assert } from "../util.ts";

export { multiplyMontgomery, montgomeryKernel };

/**
 * Pushes (lo, hi) of a * b + sum(adds) onto the stack. Each addend is a 64-bit
 * value, and the full result fits in 128 bits for up to two addends:
 * (B-1)^2 + 2(B-1) = B^2 - 1, B = 2^64.
 *
 * Constant factors 0, 1 and powers of two avoid the multiplier.
 */
function madd(a: Local<i64>, b: Local<i64> | bigint, ...adds: Local<i64>[]) {
  if (b === 0n) {
    if (adds.length === 0) {
      i64.const(0n);
      i64.const(0n);
      return;
    }
    i64.add128(adds[0], 0n, adds[1] ?? 0n, 0n);
    return;
  }
  if (typeof b === "bigint" && isPowerOfTwo(b)) {
    const k = BigInt(BigInt.asUintN(64, b).toString(2).length - 1);
    assert(adds.length > 0, "constant products always have an addend");
    i64.add128(
      k === 0n ? a : i64.shl(a, k),
      k === 0n ? 0n : i64.shr_u(a, 64n - k),
      adds[0],
      0n
    );
  } else {
    i64.mul_wide_u(a, b);
    if (adds.length > 0) i64.add128($, $, adds[0], 0n);
  }
  for (const c of adds.slice(1)) i64.add128($, $, c, 0n);
}

function isPowerOfTwo(b: bigint) {
  const u = BigInt.asUintN(64, b);
  return u !== 0n && (u & (u - 1n)) === 0n;
}

type MultiplyLocals = {
  mA: Local<i64>;
  mC: Local<i64>;
  mM: Local<i64>;
  mT: Local<i64>[];
};

/**
 * Montgomery multiplication on locals, Z = X Y / R. Z may alias X or Y.
 * Callers declare `locals` in the function that uses the kernel.
 */
function montgomeryKernel(F: FieldBase) {
  // T < p + limit throughout CIOS. With this headroom there is no extra
  // carry limb, and product and reduction can share one pass per row.
  const noOverflow = F.p + F.limit <= F.R;
  // REDC gives T < p + x*y/R. For x,y < 2p and 4p <= R, T < 2p already,
  // so no final comparison or subtraction is needed. Otherwise T < 3p (lazy)
  // or < 2p (canonical) and one subtraction suffices. The subtraction is
  // rarely needed, so a predictable branch beats a branchless select here.
  const finalReduce = !F.lazy || 4n * F.p > F.R;

  // Single interleaved pass per row ("no-carry" CIOS, as in gnark):
  //   (A, T[j]) = x[j] y[i] + T[j] + A
  //   (C, T[j-1]) = m p[j] + T[j] + C
  // The new top word A + C cannot overflow because T < R after every row.
  function merged(
    X: Local<i64>[],
    Y: Local<i64>[],
    { mA: A, mC: C, mM: m, mT: T }: MultiplyLocals
  ) {
    for (let i = 0; i < F.n; i++) {
      // In the first row T = 0, so its additions are skipped.
      if (i === 0) madd(X[0], Y[0]);
      else madd(X[0], Y[i], T[0]);
      local.set(A, $);
      local.set(T[0], $);
      local.set(m, i64.mul(T[0], F.mu));
      // The low word of m p[0] + T[0] is zero by construction; keep the carry.
      madd(m, F.P[0], T[0]);
      local.set(C, $);
      drop();
      for (let j = 1; j < F.n; j++) {
        if (i === 0) madd(X[j], Y[i], A);
        else madd(X[j], Y[i], T[j], A);
        local.set(A, $);
        local.set(T[j], $);
        madd(m, F.P[j], T[j], C);
        local.set(C, $);
        local.set(T[j - 1], $);
      }
      local.set(T[F.n - 1], i64.add(A, C));
    }
    if (finalReduce) F.reduceLocals(T, 0n, C, F.Limit);
  }

  // CIOS with separate product and reduction passes and an extra carry limb,
  // for moduli close to R (e.g. secp256k1).
  function withCarry(
    X: Local<i64>[],
    Y: Local<i64>[],
    { mA: carry, mM: m, mT: T }: MultiplyLocals
  ) {
    const n = F.n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const adds = [...(i > 0 ? [T[j]] : []), ...(j > 0 ? [carry] : [])];
        madd(X[i], Y[j], ...adds);
        local.set(carry, $);
        local.set(T[j], $);
      }
      if (i === 0) {
        local.set(T[n], carry);
        local.set(T[n + 1], 0n);
      } else {
        i64.add128(T[n], 0n, carry, 0n);
        local.set(T[n + 1], $);
        local.set(T[n], $);
      }

      local.set(m, i64.mul(T[0], F.mu));
      madd(m, F.P[0], T[0]);
      local.set(carry, $);
      drop();
      for (let j = 1; j < n; j++) {
        madd(m, F.P[j], T[j], carry);
        local.set(carry, $);
        local.set(T[j - 1], $);
      }
      i64.add128(T[n], T[n + 1], carry, 0n);
      local.set(T[n], $);
      local.set(T[n - 1], $);
    }
    F.reduceLocals(T.slice(0, n), T[n], carry, F.Limit);
  }

  const locals = {
    mA: i64,
    mC: i64,
    mM: i64,
    mT: localArray(i64, noOverflow ? F.n : F.n + 2),
  };
  function multiply(
    L: MultiplyLocals,
    Z: Local<i64>[],
    X: Local<i64>[],
    Y: Local<i64>[]
  ) {
    if (noOverflow) merged(X, Y, L);
    else withCarry(X, Y, L);
    for (let j = 0; j < F.n; j++) local.set(Z[j], L.mT[j]);
  }
  return { locals, multiply };
}

function multiplyMontgomery(F: FieldBase) {
  const K = montgomeryKernel(F);
  const multiply = func(
    {
      in: [{ xy: i32 }, { x: i32 }, { y: i32 }],
      locals: { ...K.locals, X: localArray(i64, F.n), Y: localArray(i64, F.n) },
      out: [],
    },
    ({ xy, x, y }, L) => {
      F.load(L.X, x);
      F.load(L.Y, y);
      K.multiply(L, L.X, L.X, L.Y);
      F.store(xy, L.X);
    }
  );
  // Same kernel, loading the input once. Symmetric squaring needs fewer
  // multiplications but more additions, and measured slower.
  const square = func(
    {
      in: [{ xy: i32 }, { x: i32 }],
      locals: { ...K.locals, X: localArray(i64, F.n) },
      out: [],
    },
    ({ xy, x }, L) => {
      F.load(L.X, x);
      K.multiply(L, L.X, L.X, L.X);
      F.store(xy, L.X);
    }
  );
  return { multiply, square };
}
