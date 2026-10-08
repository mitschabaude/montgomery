import {
  localArray,
  $,
  block,
  br,
  br_if,
  call,
  func,
  i32,
  i64,
  i64x2,
  if_,
  local,
  loop,
  select,
  unreachable,
  v128,
  type Local,
} from "wasmati";
import type { FieldBase } from "./field-base.ts";
import type { arithmetic } from "./arithmetic.ts";
import type { multiplyMontgomery } from "./multiply.ts";
import type { ImplicitMemory } from "../wasm/wasm-util.ts";
import { mod } from "../bigint/field-util.ts";

export { fastInverse };

/**
 * Binary GCD of (a, b) = (x, p) in batches of 62 steps, after Pornin,
 * "Optimized Binary GCD for Modular Inversion" (2020).
 *
 * b stays odd. A step subtracts b from an odd a, swapping them if the
 * difference is negative, and halves a. Each batch runs on 63 high and 64 low
 * bits of a and b, accumulating a 2x2 matrix of signed i64 entries, then
 * applies it to the full values with wide products. The steps are branchless:
 * all trailing zeros of a are removed at once, and swaps are selects.
 *
 * Coefficients with x*ca = a, x*cb = b (mod p) get the same matrix, divided by
 * 2^62 modulo p. When a reaches zero, b = gcd = 1 and cb = x^-1. A negative
 * full result, caused by an approximation, is negated with its matrix row.
 */
function fastInverse(
  F: FieldBase,
  ops: ReturnType<typeof arithmetic> & ReturnType<typeof multiplyMontgomery>,
  mem: ImplicitMemory
) {
  const batch = 62;
  const mask = (1n << BigInt(batch)) - 1n;
  // For an input xR, REDC((xR)^-1 * R^3) = x^-1 * R is the Montgomery inverse.
  const correction = mod(F.R ** 3n, F.p);
  const correctionPtr = mem.dataToOffset(
    Array.from({ length: F.size }, (_, i) =>
      Number((correction >> BigInt(8 * i)) & 255n)
    )
  );

  // (lo, hi) = x * c for an unsigned limb x and a signed coefficient c with
  // sign mask cSign = c >> 63: the unsigned product overshoots by x * 2^64.
  function product(
    x: Local<i64>,
    c: Local<i64>,
    cSign: Local<i64>,
    lo: Local<i64>,
    hi: Local<i64>
  ) {
    i64.mul_wide_u(x, c);
    local.set(hi, $);
    local.set(lo, $);
    local.set(hi, i64.sub(local.get(hi), i64.and(x, cSign)));
  }
  // lo = limb j of f*x + g*y, with the signed carry from limb j-1 in carry
  function linear(
    x: Local<i64>,
    y: Local<i64>,
    [f, fSign, g, gSign]: Local<i64>[],
    carry: Local<i64>,
    [lo, hi, otherLo, otherHi]: Local<i64>[],
    first: boolean
  ) {
    product(x, f, fSign, lo, hi);
    product(y, g, gSign, otherLo, otherHi);
    i64.add128(lo, hi, otherLo, otherHi);
    if (!first) i64.add128($, $, local.get(carry), i64.shr_s(carry, 63n));
    local.set(carry, $);
    local.set(lo, $);
  }
  // X = (X + high*R) / 2^62, high is signed
  function shift(X: Local<i64>[], high: Local<i64>) {
    for (let j = 0; j < F.n; j++)
      local.set(
        X[j],
        i64.or(
          i64.shr_u(X[j], BigInt(batch)),
          i64.shl(j + 1 < F.n ? X[j + 1] : high, BigInt(64 - batch))
        )
      );
    local.set(high, i64.shr_s(high, BigInt(batch)));
  }
  function negate(X: Local<i64>[], borrow: Local<i64>) {
    for (let j = 0; j < F.n; j++) {
      i64.sub128(0n, 0n, X[j], 0n);
      if (j > 0) i64.sub128($, $, borrow, 0n);
      local.set(borrow, i64.and($, 1n));
      local.set(X[j], $);
    }
  }
  // X + high*R in (-p, 2p) -> [0, p)
  function canonicalize(X: Local<i64>[], high: Local<i64>, carry: Local<i64>) {
    i64.lt_s(high, 0n);
    if_(
      () => {
        for (let j = 0; j < F.n; j++) {
          i64.add128(X[j], 0n, F.P[j], 0n);
          if (j > 0) i64.add128($, $, carry, 0n);
          local.set(carry, $);
          local.set(X[j], $);
        }
      },
      () => F.reduceLocals(X, high, carry)
    );
  }
  // (lo, hi) = m * c for a constant c, without the multiplier when possible
  function productConstant(m: Local<i64>, c: bigint) {
    const u = BigInt.asUintN(64, c);
    if (u === 0n) {
      i64.const(0n);
      i64.const(0n);
    } else if ((u & (u - 1n)) === 0n) {
      const k = BigInt(u.toString(2).length - 1);
      if (k === 0n) {
        local.get(m);
        i64.const(0n);
      } else {
        i64.shl(m, k);
        i64.shr_u(m, 64n - k);
      }
    } else i64.mul_wide_u(m, c);
  }
  // ca, cb = (fa ca + ga cb) / 2^62, (fb ca + gb cb) / 2^62 (mod p)
  const updateCoefficients = func(
    {
      in: [
        { ca: i32 },
        { cb: i32 },
        { fa: i64 },
        { ga: i64 },
        { fb: i64 },
        { gb: i64 },
      ],
      locals: {
        faSign: i64,
        gaSign: i64,
        fbSign: i64,
        gbSign: i64,
        aj: i64,
        bj: i64,
        carryA: i64,
        carryB: i64,
        lo: i64,
        hi: i64,
        otherLo: i64,
        otherHi: i64,
        mA: i64,
        mB: i64,
        X: localArray(i64, F.n),
        Y: localArray(i64, F.n),
      },
      out: [],
    },
    (
      { ca, cb, fa, ga, fb, gb },
      {
        faSign,
        gaSign,
        fbSign,
        gbSign,
        aj,
        bj,
        carryA,
        carryB,
        lo,
        hi,
        otherLo,
        otherHi,
        mA,
        mB,
        X,
        Y,
      }
    ) => {
      local.set(faSign, i64.shr_s(fa, 63n));
      local.set(gaSign, i64.shr_s(ga, 63n));
      local.set(fbSign, i64.shr_s(fb, 63n));
      local.set(gbSign, i64.shr_s(gb, 63n));
      const temps = [lo, hi, otherLo, otherHi];
      for (let j = 0; j < F.n; j++) {
        local.set(aj, F.loadLimb(ca, j));
        local.set(bj, F.loadLimb(cb, j));
        // Adding m*p, with m chosen from the low 62 bits, makes the division exact.
        linear(aj, bj, [fa, faSign, ga, gaSign], carryA, temps, j === 0);
        if (j === 0) local.set(mA, i64.and(i64.mul(lo, F.mu), mask));
        productConstant(mA, F.P[j]);
        i64.add128($, $, lo, carryA);
        local.set(carryA, $);
        local.set(X[j], $);
        linear(aj, bj, [fb, fbSign, gb, gbSign], carryB, temps, j === 0);
        if (j === 0) local.set(mB, i64.and(i64.mul(lo, F.mu), mask));
        productConstant(mB, F.P[j]);
        i64.add128($, $, lo, carryB);
        local.set(carryB, $);
        local.set(Y[j], $);
      }
      shift(X, carryA);
      shift(Y, carryB);
      canonicalize(X, carryA, lo);
      canonicalize(Y, carryB, lo);
      F.store(ca, X);
      F.store(cb, Y);
    }
  );

  // Three scratch elements (a, b, ca); the output holds cb. The output may
  // alias the input. Zero or a nonunit input traps.
  const inverse = func(
    {
      in: [{ scratch: i32 }, { r: i32 }, { a: i32 }],
      locals: {
        b: i32,
        ca: i32,
        length: i32,
        offset: i32,
        bitShift: i64,
        nextMask: i64,
        alo: i64,
        ahi: i64,
        blo: i64,
        bhi: i64,
        k: i64,
        rem: i64,
        sign: i64,
        dlo: i64,
        dhi: i64,
        FA: v128,
        FB: v128,
        S: v128,
        D: v128,
        fa: i64,
        ga: i64,
        fb: i64,
        gb: i64,
        faSign: i64,
        gaSign: i64,
        fbSign: i64,
        gbSign: i64,
        aj: i64,
        bj: i64,
        carryA: i64,
        carryB: i64,
        lo: i64,
        hi: i64,
        otherLo: i64,
        otherHi: i64,
        X: localArray(i64, F.n),
        Y: localArray(i64, F.n),
      },
      out: [],
    },
    (
      { scratch: a, r: cb, a: input },
      {
        b,
        ca,
        length,
        offset,
        bitShift,
        nextMask,
        alo,
        ahi,
        blo,
        bhi,
        k,
        rem,
        sign,
        dlo,
        dhi,
        FA,
        FB,
        S,
        D,
        fa,
        ga,
        fb,
        gb,
        faSign,
        gaSign,
        fbSign,
        gbSign,
        aj,
        bj,
        carryA,
        carryB,
        lo,
        hi,
        otherLo,
        otherHi,
        X,
        Y,
      }
    ) => {
      local.set(b, i32.add(a, F.size));
      local.set(ca, i32.add(a, 2 * F.size));
      call(ops.copy, { x: a, y: input });
      call(ops.reduce, { x: a });
      call(ops.isZero, { x: a });
      if_(() => unreachable());
      for (let j = 0; j < F.n; j++) {
        F.storeLimb(b, j, F.P[j]);
        F.storeLimb(ca, j, j === 0 ? 1n : 0n);
        F.storeLimb(cb, j, 0n);
      }
      block((done) => {
        loop((again) => {
          // length = max(bitLength(a), bitLength(b)) = bitLength(a | b)
          local.set(length, 0);
          for (let j = 0; j < F.n; j++) {
            local.set(lo, i64.or(F.loadLimb(a, j), F.loadLimb(b, j)));
            i32.sub(i32.const(64 * (j + 1)), i32.wrap_i64(i64.clz(lo)));
            local.get(length);
            i64.ne(lo, 0n);
            select(i32);
            local.set(length, $);
          }
          // high approximations: 63 bits from start = max(length - 63, 0)
          local.set(offset, i32.sub(length, 63));
          local.set(
            offset,
            i32.and(i32.xor(i32.shr_s(offset, 31), -1), offset)
          );
          local.set(bitShift, i64.extend_i32_u(i32.and(offset, 63)));
          // bits from the next limb exist unless the shift is 0 or this is the top limb
          i64.const(0n);
          i32.and(
            i64.ne(bitShift, 0n),
            i32.lt_u(i32.shr_u(offset, 6), F.n - 1)
          );
          local.set(nextMask, i64.sub($, i64.extend_i32_u($)));
          local.set(offset, i32.shl(i32.shr_u(offset, 6), 3));
          for (const [x, out] of [
            [a, ahi],
            [b, bhi],
          ] as const) {
            i64.shr_u(i64.load({}, i32.add(x, offset)), bitShift);
            i64.shl(
              i64.load({ offset: 8 }, i32.add(x, offset)),
              i64.sub(64n, bitShift)
            );
            local.set(out, i64.or($, i64.and($, nextMask)));
          }
          local.set(alo, F.loadLimb(a, 0));
          local.set(blo, F.loadLimb(b, 0));

          // FA = (fa, ga), FB = (fb, gb): a' = fa a + ga b, b' = fb a + gb b,
          // both scaled by 2^62. rem is a sentinel bit at the number of
          // remaining steps, so ctz(x | rem) is at most that number.
          local.set(FA, v128.const("i64x2", [1n, 0n]));
          local.set(FB, v128.const("i64x2", [0n, 1n]));
          local.set(rem, 1n << BigInt(batch));
          // a may start even
          local.set(k, i64.ctz(i64.or(alo, rem)));
          local.set(alo, i64.shr_u(alo, k));
          local.set(ahi, i64.shr_s(ahi, k));
          local.set(FB, i64x2.shl(local.get(FB), i32.wrap_i64(k)));
          local.set(rem, i64.shr_u(rem, k));
          block((stepsDone) => {
            loop((step) => {
              i64.eq(rem, 1n);
              br_if(stepsDone);
              // a, b odd: d = a - b. |d| has the trailing zeros of d, so the
              // shift does not wait for the sign.
              local.set(dlo, i64.sub(alo, blo));
              local.set(dhi, i64.sub(ahi, bhi));
              local.set(k, i64.ctz(i64.or(dlo, rem)));
              local.set(sign, i64.shr_s(dhi, 63n));
              // b = min(a, b), a = |d| / 2^k
              local.get(ahi);
              local.get(bhi);
              i32.wrap_i64(sign);
              select(i64);
              local.set(bhi, $);
              local.get(alo);
              local.get(blo);
              i32.wrap_i64(sign);
              select(i64);
              local.set(blo, $);
              local.set(ahi, i64.shr_s(i64.sub(i64.xor(dhi, sign), sign), k));
              local.set(alo, i64.shr_u(i64.sub(i64.xor(dlo, sign), sign), k));
              local.set(rem, i64.shr_u(rem, k));
              // rows: FB = sign ? FA : FB, FA = |FA - FB|, then FB *= 2^k
              local.set(S, i64x2.splat(sign));
              local.set(D, i64x2.sub(FA, FB));
              local.set(FB, v128.xor(v128.and(v128.xor(FA, FB), S), FB));
              local.set(FB, i64x2.shl(local.get(FB), i32.wrap_i64(k)));
              local.set(FA, i64x2.sub(v128.xor(D, S), S));
              br(step);
            });
          });
          local.set(fa, i64x2.extract_lane(0, FA));
          local.set(ga, i64x2.extract_lane(1, FA));
          local.set(fb, i64x2.extract_lane(0, FB));
          local.set(gb, i64x2.extract_lane(1, FB));
          local.set(faSign, i64.shr_s(fa, 63n));
          local.set(gaSign, i64.shr_s(ga, 63n));
          local.set(fbSign, i64.shr_s(fb, 63n));
          local.set(gbSign, i64.shr_s(gb, 63n));
          const temps = [lo, hi, otherLo, otherHi];
          for (let j = 0; j < F.n; j++) {
            local.set(aj, F.loadLimb(a, j));
            local.set(bj, F.loadLimb(b, j));
            linear(aj, bj, [fa, faSign, ga, gaSign], carryA, temps, j === 0);
            local.set(X[j], lo);
            linear(aj, bj, [fb, fbSign, gb, gbSign], carryB, temps, j === 0);
            local.set(Y[j], lo);
          }
          shift(X, carryA);
          shift(Y, carryB);
          i64.lt_s(carryA, 0n);
          if_(() => {
            negate(X, lo);
            local.set(fa, i64.sub(0n, fa));
            local.set(ga, i64.sub(0n, ga));
          });
          i64.lt_s(carryB, 0n);
          if_(() => {
            negate(Y, lo);
            local.set(fb, i64.sub(0n, fb));
            local.set(gb, i64.sub(0n, gb));
          });
          F.store(a, X);
          F.store(b, Y);
          call(updateCoefficients, { ca, cb, fa, ga, fb, gb });
          // b stays odd; a = 0 means b = gcd and x*cb = b
          i64.or(X[0], X[1 % F.n]);
          for (let j = 2; j < F.n; j++) i64.or($, X[j]);
          i64.eqz($);
          br_if(done);
          br(again);
        });
      });
      // gcd must be one. This also rejects nonunits of an odd composite modulus.
      i64.ne(F.loadLimb(b, 0), 1n);
      for (let j = 1; j < F.n; j++) {
        i64.ne(F.loadLimb(b, j), 0n);
        i32.or();
      }
      if_(() => unreachable());
      call(ops.multiply, { xy: cb, x: cb, y: correctionPtr });
    }
  );
  return inverse;
}
