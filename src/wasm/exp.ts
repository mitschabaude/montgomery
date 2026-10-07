import type { Func } from "wasmati";
import { call, func, i32, if_, local } from "wasmati";
import { mod } from "../bigint/field-util.ts";
import { forLoop1 } from "./wasm-util.ts";
import { type FieldWithMultiply } from "./multiply-montgomery.ts";

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
    {
      in: [{ x: i32 }, { z: i32 }, { xIn: i32 }, { n: i32 }],
      locals: { j: i32, ni: i32 },
      out: [],
    },
    ({ x, z, xIn, n }, { j, ni }) => {
      Field.i32.store(z, mgOne);
      call(copy, { x, y: xIn });
      Field.forEach((i) => {
        local.set(ni, Field.i32.loadLimb(n, i));
        forLoop1(j, 0, w, () => {
          i32.and(ni, i32.shl(1, j));
          if_(() => {
            call(multiply, { xy: z, x: z, y: x });
          });
          call(square, { xy: x, x });
        });
      });
    }
  );

  return exp;
}
