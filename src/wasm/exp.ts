import type { Func } from "wasmati";
import { call, func, i32, if_, local } from "wasmati";
import { mod } from "../bigint/field-util.js";
import { forLoop1 } from "./wasm-util.js";
import { FieldWithMultiply } from "./multiply-montgomery.js";

export { fieldExp };

type fieldExp = ReturnType<typeof fieldExp>;

function fieldExp(Field: FieldWithMultiply) {
  let { copy, multiply, square, p, w, R } = Field;
  let mgOne = Field.i32.bigintToLimbs(mod(R, p));

  /**
   * z = x^n mod p
   *
   * z, x are passed in montgomery form, n as a plain field element
   *
   * first input is 1 field element of scratch space
   */
  const exp = func(
    { in: [i32, i32, i32, i32], locals: [i32, i32], out: [] },
    ([x, z, xIn, n], [j, ni]) => {
      Field.i32.store(z, mgOne);
      call(copy, [x, xIn]);
      Field.forEach((i) => {
        local.set(ni, Field.i32.loadLimb(n, i));
        forLoop1(j, 0, w, () => {
          i32.and(ni, i32.shl(1, j));
          if_(null, () => {
            call(multiply, [z, z, x]);
          });
          call(square, [x, x]);
        });
      });
    }
  );

  return exp;
}
