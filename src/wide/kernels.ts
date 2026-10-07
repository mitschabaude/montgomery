import { $, i64, local, localArray, type Input, type Local } from "wasmati";
import type { FieldBase } from "./field-base.ts";
import { montgomeryKernel } from "./multiply.ts";
import { additionKernels } from "./arithmetic.ts";

export { fieldKernels };

/**
 * Field arithmetic on locals, for generating fused functions that keep
 * intermediate field elements out of memory. A function using the kernels
 * declares `locals` plus one `element()` per field element it holds.
 */
function fieldKernels(F: FieldBase) {
  const M = montgomeryKernel(F);
  const A = additionKernels(F);
  return {
    locals: { ...M.locals, ...A.locals },
    element: () => localArray(i64, F.n),
    load(X: Local<i64>[], ptr: Input<"i32">, offset = 0) {
      X.forEach((x, i) =>
        local.set(x, i64.load({ offset: offset + 8 * i }, ptr))
      );
    },
    store(ptr: Input<"i32">, X: Local<i64>[], offset = 0) {
      X.forEach((x, i) => i64.store({ offset: offset + 8 * i }, ptr, x));
    },
    multiply: M.multiply,
    square(
      L: Parameters<typeof M.multiply>[0],
      Z: Local<i64>[],
      X: Local<i64>[]
    ) {
      M.multiply(L, Z, X, X);
    },
    add: A.add,
    subtract: A.subtract,
    /** canonical representative in [0, p) */
    reduce(L: { aBorrow: Local<i64> }, X: Local<i64>[]) {
      F.reduceLocals(X, 0n, L.aBorrow);
    },
    /** pushes X == Y (raw representations) */
    isEqual(X: Local<i64>[], Y: Local<i64>[]) {
      i64.xor(X[0], Y[0]);
      for (let i = 1; i < F.n; i++) i64.or($, i64.xor(X[i], Y[i]));
      i64.eqz($);
    },
  };
}
