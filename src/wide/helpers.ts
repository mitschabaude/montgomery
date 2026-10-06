import { $, call, func, i32, i64, if_, local, unreachable } from "wasmati";
import type { FieldBase } from "./field-base.ts";
import type { arithmetic } from "./arithmetic.ts";
import type { multiplyMontgomery } from "./multiply.ts";
import type { ImplicitMemory } from "../wasm/wasm-util.ts";
import { forLoop1 } from "../wasm/wasm-util.ts";

export { helpers };

function helpers(
  F: FieldBase,
  ops: ReturnType<typeof arithmetic> & ReturnType<typeof multiplyMontgomery>,
  mem: ImplicitMemory
) {
  const limbs = Array(F.n).fill(i64) as [typeof i64, ...(typeof i64)[]];
  const zero = mem.dataToOffset(Array(F.size).fill(0));
  const negate = func({ in: [i32, i32], out: [] }, ([z, x]) => {
    call(ops.subtract, [z, zero, x]);
  });
  const bitLength = F.p.toString(2).length;
  const packedSize = Math.ceil(bitLength / 8);
  const powers: number[] = [];
  for (let k = 0; k < bitLength; k++) {
    const x = 1n << BigInt(k);
    for (let i = 0; i < F.size; i++)
      powers.push(Number((x >> BigInt(8 * i)) & 255n));
  }
  const powersPtr = mem.dataToOffset(powers);
  // Match the production leftShift contract: raw multiplication by 2^k
  // through REDC, so the result includes R^-1. 0 <= k < bitLength(p).
  const leftShift = func({ in: [i32, i32, i32], out: [] }, ([z, x, k]) => {
    i32.ge_u(k, bitLength);
    if_(null, () => unreachable());
    call(ops.multiply, [z, x, i32.add(powersPtr, i32.mul(k, F.size))]);
  });
  // One scratch element, disjoint from all inputs/output. Output may alias x.
  // The exponent uses the ordinary little-endian 64-bit limb representation.
  const exp = func(
    { in: [i32, i32, i32, i32], locals: [i32, i64, i64, ...limbs], out: [] },
    ([scratch, z, x, exponent], [j, ni, mask, ...E]) => {
      F.load(E, exponent);
      call(ops.copy, [scratch, x]);
      const one = F.R % F.p;
      for (let i = 0; i < F.n; i++)
        F.storeLimb(z, i, BigInt.asIntN(64, one >> BigInt(64 * i)));
      for (let i = F.n - 1; i >= 0; i--) {
        local.set(ni, E[i]);
        local.set(mask, -(1n << 63n));
        forLoop1(j, 0, 64, () => {
          call(ops.square, [z, z]);
          i64.ne(i64.and(ni, mask), 0n);
          if_(null, () => {
            call(ops.multiply, [z, z, scratch]);
          });
          local.set(mask, i64.shr_u(mask, 1n));
        });
      }
    }
  );
  // Packing is raw (no Montgomery conversion or modular reduction), like
  // the production Wasm helpers. The input must fit in packedSize bytes.
  const toPackedBytes = func(
    { in: [i32, i32], locals: limbs, out: [] },
    ([bytes, x], X) => {
      F.load(X, x);
      for (let i = 0; i < packedSize; i++) {
        i32.store8(
          { offset: i },
          bytes,
          i32.wrap_i64(i64.shr_u(X[Math.floor(i / 8)], BigInt(8 * (i % 8))))
        );
      }
    }
  );
  const fromPackedBytes = func(
    { in: [i32, i32], locals: limbs, out: [] },
    ([x, bytes], X) => {
      for (let i = 0; i < packedSize; i++) {
        i64.extend_i32_u(i32.load8_u({ offset: i }, bytes));
        i64.shl($, BigInt(8 * (i % 8)));
        local.set(X[Math.floor(i / 8)], i64.or($, X[Math.floor(i / 8)]));
      }
      F.store(x, X);
    }
  );
  return { negate, leftShift, exp, toPackedBytes, fromPackedBytes };
}
