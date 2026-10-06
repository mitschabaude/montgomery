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
  return_,
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

// Port of inverse/faster-inverse-wasm.ts: accumulate binary steps in a
// 2x2 matrix using high/low approximations, then apply it to full integers.
// A batch is 62 bits, independently of the 64-bit memory limb size: matrix
// entries fit signed i64 and wide products retain every carry. Coefficients
// are divided by 2^62 modulo p each batch, keeping them canonical even for
// moduli close to R. Negative approximate remainders are corrected exactly.
function fastInverse(
  F: FieldBase,
  ops: ReturnType<typeof arithmetic> & ReturnType<typeof multiplyMontgomery>,
  mem: ImplicitMemory
) {
  const batch = 62;
  const mask = (1n << BigInt(batch)) - 1n;
  const correction = mod(F.R ** 3n, F.p);
  const correctionPtr = mem.dataToOffset(
    Array.from({ length: F.size }, (_, i) =>
      Number((correction >> BigInt(8 * i)) & 255n)
    )
  );
  const bitLength = func(
    { in: [{ x: i32 }], locals: { xi: i64 }, out: [i32] },
    ({ x }, { xi }) => {
      for (let j = F.n - 1; j >= 0; j--) {
        local.set(xi, F.loadLimb(x, j));
        i64.ne(xi, 0n);
        if_(null, () => {
          i32.sub(64 * (j + 1), i32.wrap_i64(i64.clz(xi)));
          return_();
        });
      }
      i32.const(0);
    }
  );
  const highBits = func(
    {
      in: [{ x: i32 }, { length: i32 }],
      locals: { start: i32, shift: i64, hi: i64 },
      out: [i64],
    },
    ({ x, length }, { start, shift, hi }) => {
      // At most 63 significant bits, so signed comparisons have headroom.
      local.set(start, i32.sub(length, 63));
      i32.lt_s(start, 0);
      if_(null, () => local.set(start, 0));
      local.set(shift, i64.extend_i32_u(i32.and(start, 63)));
      local.set(x, i32.add(x, i32.shl(i32.shr_u(start, 6), 3)));
      local.set(hi, i64.shr_u(i64.load({}, x), shift));
      i64.ne(shift, 0n);
      if_(null, () => {
        // A smaller operand may not have a limb above the selected position.
        // Check against its own layout rather than reading adjacent scratch.
        i32.lt_u(i32.shr_u(start, 6), F.n - 1);
        if_(null, () =>
          local.set(
            hi,
            i64.or(hi, i64.shl(i64.load({ offset: 8 }, x), i64.sub(64n, shift)))
          )
        );
      });
      local.get(hi);
    }
  );

  // Unsigned limb times signed coefficient: mul_wide_s needs a high-word
  // correction when the limb's sign bit is set.
  function product(
    x: Local<i64>,
    coefficient: Local<i64>,
    lo: Local<i64>,
    hi: Local<i64>
  ) {
    i64.mul_wide_s(x, coefficient);
    local.set(hi, $);
    local.set(lo, $);
    local.set(hi, i64.add(hi, i64.and(coefficient, i64.shr_s(x, 63n))));
  }
  function linear(
    x: Local<i64>,
    y: Local<i64>,
    f: Local<i64>,
    g: Local<i64>,
    carry: Local<i64>,
    lo: Local<i64>,
    hi: Local<i64>,
    otherLo: Local<i64>,
    otherHi: Local<i64>,
    first: boolean
  ) {
    product(x, f, lo, hi);
    product(y, g, otherLo, otherHi);
    i64.sub128(lo, hi, otherLo, otherHi);
    if (!first) i64.add128($, $, carry, i64.shr_s(carry, 63n));
    local.set(carry, $);
    local.set(lo, $);
  }
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
    local.set(borrow, 0n);
    for (let j = 0; j < F.n; j++) {
      i64.sub128(0n, 0n, X[j], 0n);
      if (j > 0) i64.sub128($, $, borrow, 0n);
      local.set(borrow, i64.and($, 1n));
      local.set(X[j], $);
    }
  }
  function canonicalize(X: Local<i64>[], high: Local<i64>, carry: Local<i64>) {
    i64.lt_s(high, 0n);
    if_(
      null,
      () => {
        local.set(carry, 0n);
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
  const updateCoefficients = func(
    {
      in: [
        { r: i32 },
        { s: i32 },
        { f0: i64 },
        { g0: i64 },
        { f1: i64 },
        { g1: i64 },
      ],
      locals: {
        rj: i64,
        sj: i64,
        carryR: i64,
        carryS: i64,
        lo: i64,
        hi: i64,
        otherLo: i64,
        otherHi: i64,
        mR: i64,
        mS: i64,
        X: localArray(i64, F.n),
        Y: localArray(i64, F.n),
      },
      out: [],
    },
    (
      { r, s, f0, g0, f1, g1 },
      { rj, sj, carryR, carryS, lo, hi, otherLo, otherHi, mR, mS, X, Y }
    ) => {
      for (let j = 0; j < F.n; j++) {
        local.set(rj, F.loadLimb(r, j));
        local.set(sj, F.loadLimb(s, j));
        linear(rj, sj, f0, g0, carryR, lo, hi, otherLo, otherHi, j === 0);
        if (j === 0) local.set(mR, i64.and(i64.mul(lo, F.mu), mask));
        i64.mul_wide_u(F.P[j], mR);
        i64.add128($, $, lo, carryR);
        local.set(carryR, $);
        local.set(X[j], $);
        linear(sj, rj, g1, f1, carryS, lo, hi, otherLo, otherHi, j === 0);
        if (j === 0) local.set(mS, i64.and(i64.mul(lo, F.mu), mask));
        i64.mul_wide_u(F.P[j], mS);
        i64.add128($, $, lo, carryS);
        local.set(carryS, $);
        local.set(Y[j], $);
      }
      shift(X, carryR);
      shift(Y, carryS);
      canonicalize(X, carryR, lo);
      canonicalize(Y, carryS, lo);
      F.store(r, X);
      F.store(s, Y);
    }
  );
  // The output parameter r holds the coefficient s; local r is the other one.
  const inverse = func(
    {
      in: [{ scratch: i32 }, { r: i32 }, { a: i32 }],
      locals: {
        u: i32,
        r: i32,
        length: i32,
        vLength: i32,
        ulo: i64,
        vlo: i64,
        uhi: i64,
        vhi: i64,
        f0g0: v128,
        f1g1: v128,
        f0: i64,
        g0: i64,
        f1: i64,
        g1: i64,
        uj: i64,
        vj: i64,
        carryU: i64,
        carryV: i64,
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
      { scratch: v, r: s, a },
      {
        u,
        r,
        length,
        vLength,
        ulo,
        vlo,
        uhi,
        vhi,
        f0g0,
        f1g1,
        f0,
        g0,
        f1,
        g1,
        uj,
        vj,
        carryU,
        carryV,
        lo,
        hi,
        otherLo,
        otherHi,
        X,
        Y,
      }
    ) => {
      local.set(u, i32.add(v, F.size));
      local.set(r, i32.add(v, 2 * F.size));
      call(ops.copy, { x: v, y: a });
      call(ops.reduce, { x: v });
      call(ops.isZero, { x: v });
      if_(null, () => unreachable());
      for (let j = 0; j < F.n; j++) {
        F.storeLimb(u, j, F.P[j]);
        F.storeLimb(r, j, 0n);
        F.storeLimb(s, j, j === 0 ? 1n : 0n);
      }
      block(null, (done) => {
        loop(null, (again) => {
          local.set(f0g0, v128.const("i64x2", [1n, 0n]));
          local.set(f1g1, v128.const("i64x2", [0n, 1n]));
          local.set(ulo, F.loadLimb(u, 0));
          local.set(vlo, F.loadLimb(v, 0));
          call(bitLength, { x: u });
          local.set(length, $);
          call(bitLength, { x: v });
          local.set(vLength, $);
          local.get(vLength);
          local.get(length);
          i32.gt_u(vLength, length);
          select(i32);
          local.set(length, $);
          call(highBits, { x: u, length });
          local.set(uhi, $);
          call(highBits, { x: v, length });
          local.set(vhi, $);
          for (let j = 0; j < batch; j++) {
            i64.eqz(i64.and(ulo, 1n));
            if_(
              null,
              () => {
                local.set(uhi, i64.shr_s(uhi, 1n));
                local.set(ulo, i64.shr_s(ulo, 1n));
                local.set(f1g1, i64x2.shl(f1g1, 1));
              },
              () => {
                i64.eqz(i64.and(vlo, 1n));
                if_(
                  null,
                  () => {
                    local.set(vhi, i64.shr_s(vhi, 1n));
                    local.set(vlo, i64.shr_s(vlo, 1n));
                    local.set(f0g0, i64x2.shl(f0g0, 1));
                  },
                  () => {
                    i64.le_s(vhi, uhi);
                    if_(
                      null,
                      () => {
                        local.set(uhi, i64.shr_s(i64.sub(uhi, vhi), 1n));
                        local.set(ulo, i64.shr_s(i64.sub(ulo, vlo), 1n));
                        local.set(f0g0, i64x2.add(f0g0, f1g1));
                        local.set(f1g1, i64x2.shl(f1g1, 1));
                      },
                      () => {
                        local.set(vhi, i64.shr_s(i64.sub(vhi, uhi), 1n));
                        local.set(vlo, i64.shr_s(i64.sub(vlo, ulo), 1n));
                        local.set(f1g1, i64x2.add(f0g0, f1g1));
                        local.set(f0g0, i64x2.shl(f0g0, 1));
                      }
                    );
                  }
                );
              }
            );
          }
          local.set(f0, i64x2.extract_lane(0, f0g0));
          local.set(g0, i64x2.extract_lane(1, f0g0));
          local.set(f1, i64x2.extract_lane(0, f1g1));
          local.set(g1, i64x2.extract_lane(1, f1g1));
          for (let j = 0; j < F.n; j++) {
            local.set(uj, F.loadLimb(u, j));
            local.set(vj, F.loadLimb(v, j));
            linear(uj, vj, f0, g0, carryU, lo, hi, otherLo, otherHi, j === 0);
            local.set(X[j], lo);
            linear(vj, uj, g1, f1, carryV, lo, hi, otherLo, otherHi, j === 0);
            local.set(Y[j], lo);
          }
          shift(X, carryU);
          shift(Y, carryV);
          i64.lt_s(carryU, 0n);
          if_(null, () => {
            negate(X, lo);
            local.set(f0, i64.sub(0n, f0));
            local.set(g0, i64.sub(0n, g0));
          });
          i64.lt_s(carryV, 0n);
          if_(null, () => {
            negate(Y, lo);
            local.set(f1, i64.sub(0n, f1));
            local.set(g1, i64.sub(0n, g1));
          });
          F.store(u, X);
          F.store(v, Y);
          call(updateCoefficients, { r, s, f0, g0, f1, g1 });
          call(ops.isZero, { x: u });
          br_if(done);
          call(ops.isZero, { x: v });
          if_(null, () => {
            call(ops.copy, { x: s, y: r });
            call(ops.copy, { x: v, y: u });
            br(done);
          });
          br(again);
        });
      });
      i64.ne(F.loadLimb(v, 0), 1n);
      for (let j = 1; j < F.n; j++) {
        i64.ne(F.loadLimb(v, j), 0n);
        i32.or();
      }
      if_(null, () => unreachable());
      call(ops.multiply, { xy: s, x: s, y: correctionPtr });
    }
  );
  return inverse;
}
