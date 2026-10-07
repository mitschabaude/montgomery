import {
  $,
  block,
  br,
  br_if,
  call,
  func,
  i32,
  i64,
  if_,
  local,
  loop,
  memory,
  return_,
  unreachable,
} from "wasmati";
import type { FieldBase } from "./field-base.ts";
import type { arithmetic } from "./arithmetic.ts";
import type { multiplyMontgomery } from "./multiply.ts";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.ts";
import { mod } from "../bigint/field-util.ts";

import { fastInverse } from "./fast-inverse.ts";

export { fieldInverse };

function fieldInverse(
  F: FieldBase,
  ops: ReturnType<typeof arithmetic> & ReturnType<typeof multiplyMontgomery>,
  mem: ImplicitMemory
) {
  const { n, size, p, R } = F;
  function bytes(x: bigint) {
    return Array.from({ length: size }, (_, i) =>
      Number((x >> BigInt(8 * i)) & 255n)
    );
  }
  const pPtr = mem.dataToOffset(bytes(p));
  // If a*r = -2^k (mod p), multiplying (p-r) by this plain
  // correction through REDC yields a^-1*R^2, i.e. the Montgomery inverse.
  let c = mod(R * R * R, p);
  const corrections: number[] = [];
  for (let k = 0; k <= 2 * n * 64; k++) {
    corrections.push(...bytes(c));
    c = (c & 1n) === 0n ? c >> 1n : (c + p) >> 1n;
  }
  const correctionPtr = mem.dataToOffset(corrections);

  // u /= 2^k, s *= 2^k. Kaliski's invariants ensure s*2^k <= p.
  const makeOdd = func(
    {
      in: [{ u: i32 }, { s: i32 }],
      locals: { k: i64, l: i64, tmp: i64, total: i32 },
      out: [i32],
    },
    ({ u, s }, { k, l, tmp, total }) => {
      local.set(k, i64.ctz(F.loadLimb(u, 0)));
      i64.eqz(k);
      if_(() => {
        i32.const(0);
        return_();
      });
      block((done) => {
        loop((again) => {
          i64.ne(k, 64n);
          br_if(done);
          local.get(u);
          i32.add(u, 8);
          i32.const(size - 8);
          memory.copy();
          F.storeLimb(u, n - 1, 0n);
          i32.add(s, 8);
          local.get(s);
          i32.const(size - 8);
          memory.copy();
          F.storeLimb(s, 0, 0n);
          local.set(total, i32.add(total, 64));
          local.set(k, i64.ctz(F.loadLimb(u, 0)));
          br(again);
        });
      });
      // Whole-word shifts can leave an odd low word: do not shift by 64.
      i64.ne(k, 0n);
      if_(() => {
        local.set(l, i64.sub(64n, k));
        local.set(tmp, F.loadLimb(u, 0));
        for (let i = 0; i < n; i++) {
          i64.shr_u(tmp, k);
          if (i + 1 < n) {
            local.tee(tmp, F.loadLimb(u, i + 1));
            i64.shl($, l);
            i64.or();
          }
          F.storeLimb(u, i, $);
        }
        local.set(tmp, F.loadLimb(s, n - 1));
        for (let i = n - 2; i >= 0; i--) {
          i64.shl(tmp, k);
          local.tee(tmp, F.loadLimb(s, i));
          i64.shr_u($, l);
          i64.or();
          F.storeLimb(s, i + 1, $);
        }
        F.storeLimb(s, 0, i64.shl(tmp, k));
      });
      i32.add(total, i32.wrap_i64(k));
    }
  );

  // Three scratch elements (u, v, s); r may alias a. Input is preserved
  // unless it is also the output. Zero/noninvertible input traps.
  const inverseKaliski = func(
    {
      in: [{ scratch: i32 }, { r: i32 }, { a: i32 }],
      locals: { v: i32, s: i32, k: i32 },
      out: [],
    },
    ({ scratch, r, a }, { v, s, k }) => {
      local.set(v, i32.add(scratch, size));
      local.set(s, i32.add(scratch, 2 * size));
      call(ops.copy, { x: v, y: a });
      call(ops.reduce, { x: v });
      call(ops.isZero, { x: v });
      if_(() => unreachable());
      call(ops.copy, { x: scratch, y: pPtr });
      for (let i = 0; i < n; i++) {
        F.storeLimb(r, i, 0n);
        F.storeLimb(s, i, i === 0 ? 1n : 0n);
      }
      call(makeOdd, { u: v, s: r });
      local.set(k, $);
      block((done) => {
        loop((again) => {
          call(ops.isGreater, { x: scratch, y: v });
          if_(
            () => {
              call(ops.subtractNoReduce, { out: scratch, x: scratch, y: v });
              call(ops.addNoReduce, { out: r, x: r, y: s });
              call(makeOdd, { u: scratch, s });
              local.set(k, i32.add($, k));
            },
            () => {
              call(ops.subtractNoReduce, { out: v, x: v, y: scratch });
              call(ops.addNoReduce, { out: s, x: s, y: r });
              call(ops.isZero, { x: v });
              br_if(done);
              call(makeOdd, { u: v, s: r });
              local.set(k, i32.add($, k));
            }
          );
          br(again);
        });
      });
      // gcd must be one. This also rejects nonunits of an odd composite modulus.
      F.loadLimb(scratch, 0);
      i64.ne($, 1n);
      for (let i = 1; i < n; i++) {
        i64.ne(F.loadLimb(scratch, i), 0n);
        i32.or();
      }
      if_(() => unreachable());
      call(ops.subtractNoReduce, { out: r, x: pPtr, y: r });
      call(ops.multiply, {
        xy: r,
        x: r,
        y: i32.add(correctionPtr, i32.mul(k, size)),
      });
    }
  );

  const inverse = fastInverse(F, ops, mem);

  // Four scratch elements. As in the production backend, batch output must
  // not overlap input: output is used for prefix products before inversion.
  const batchInverse = func(
    {
      in: [{ scratch: i32 }, { z: i32 }, { x: i32 }, { $n: i32 }],
      locals: { i: i32, inv: i32 },
      out: [],
    },
    ({ scratch, z, x, $n }, { i, inv }) => {
      i32.eqz($n);
      if_(() => return_());
      local.set(inv, scratch);
      local.set(scratch, i32.add(scratch, size));
      i32.eq($n, 1);
      if_(() => {
        call(inverse, { scratch, r: z, a: x });
        return_();
      });
      call(ops.copy, { x: z, y: x });
      forLoop1(i, 1, $n, () => {
        call(ops.multiply, {
          xy: i32.add(z, i32.mul(i, size)),
          x: i32.add(z, i32.mul(i32.sub(i, 1), size)),
          y: i32.add(x, i32.mul(i, size)),
        });
      });
      call(inverse, {
        scratch,
        r: inv,
        a: i32.add(z, i32.mul(i32.sub($n, 1), size)),
      });
      block((done) => {
        local.set(i, i32.sub($n, 1));
        loop((again) => {
          i32.eqz(i);
          br_if(done);
          call(ops.multiply, {
            xy: i32.add(z, i32.mul(i, size)),
            x: i32.add(z, i32.mul(i32.sub(i, 1), size)),
            y: inv,
          });
          call(ops.multiply, {
            xy: inv,
            x: inv,
            y: i32.add(x, i32.mul(i, size)),
          });
          local.set(i, i32.sub(i, 1));
          br(again);
        });
      });
      call(ops.copy, { x: z, y: inv });
    }
  );
  return { inverse, inverseKaliski, batchInverse };
}
