import { localArray, $, call, func, i32, i64, if_, local } from "wasmati";
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
  const zero = mem.dataToOffset(Array(F.size).fill(0));
  const negate = func(
    { in: [{ out: i32 }, { x: i32 }], out: [] },
    ({ out, x }) => {
      call(ops.subtract, { out, x: zero, y: x });
    }
  );
  const bitLength = F.p.toString(2).length;
  const packedSize = Math.ceil(bitLength / 8);
  // z = xIn^n. x is one scratch element, disjoint from all inputs/output.
  // Output may alias xIn.
  // The exponent uses the ordinary little-endian 64-bit limb representation.
  const exp = func(
    {
      in: [{ x: i32 }, { z: i32 }, { xIn: i32 }, { n: i32 }],
      locals: { j: i32, ni: i64, mask: i64, E: localArray(i64, F.n) },
      out: [],
    },
    ({ x, z, xIn, n }, { j, ni, mask, E }) => {
      F.load(E, n);
      call(ops.copy, { x, y: xIn });
      const one = F.R % F.p;
      for (let i = 0; i < F.n; i++)
        F.storeLimb(z, i, BigInt.asIntN(64, one >> BigInt(64 * i)));
      for (let i = F.n - 1; i >= 0; i--) {
        local.set(ni, E[i]);
        local.set(mask, -(1n << 63n));
        forLoop1(j, 0, 64, () => {
          call(ops.square, { xy: z, x: z });
          i64.ne(i64.and(ni, mask), 0n);
          if_(() => {
            call(ops.multiply, { xy: z, x: z, y: x });
          });
          local.set(mask, i64.shr_u(mask, 1n));
        });
      }
    }
  );
  // Packing is raw (no Montgomery conversion or modular reduction), like
  // the production Wasm helpers. The input must fit in packedSize bytes.
  const toPackedBytes = func(
    {
      in: [{ bytes: i32 }, { x: i32 }],
      locals: { X: localArray(i64, F.n) },
      out: [],
    },
    ({ bytes, x }, { X }) => {
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
    {
      in: [{ x: i32 }, { bytes: i32 }],
      locals: { X: localArray(i64, F.n) },
      out: [],
    },
    ({ x, bytes }, { X }) => {
      for (let i = 0; i < packedSize; i++) {
        i64.extend_i32_u(i32.load8_u({ offset: i }, bytes));
        i64.shl($, BigInt(8 * (i % 8)));
        local.set(X[Math.floor(i / 8)], i64.or($, X[Math.floor(i / 8)]));
      }
      F.store(x, X);
    }
  );
  return { negate, exp, toPackedBytes, fromPackedBytes };
}
