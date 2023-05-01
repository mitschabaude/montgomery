import type * as W from "wasmati"; // for type names
import { call, func, i32, local, global } from "wasmati";
import { FieldWithMultiply } from "./multiply-montgomery.js";
import { mod } from "../finite-field-js.js";
import { ImplicitMemory } from "./wasm-util.js";

export { curveOps };

/**
 *
 * @param implicitMemory
 * @param Field
 * @param beta cube root in the base field for endomorphism
 * @returns
 */
function curveOps(
  implicitMemory: ImplicitMemory,
  Field: FieldWithMultiply,
  beta: bigint
) {
  const addAffine = func(
    { in: [i32, i32, i32, i32, i32], locals: [i32, i32, i32, i32], out: [] },
    ([m, x3, x1, x2, d], [y3, y1, y2, tmp]) => {
      // compute other pointers from inputs
      local.set(y1, i32.add(x1, Field.size));
      local.set(y2, i32.add(x2, Field.size));
      local.set(y3, i32.add(x3, Field.size));
      local.set(tmp, i32.add(m, Field.size));

      // mark output point as non-zero
      i32.store8({ offset: 2 * Field.size }, x3, 1);

      // m = (y2 - y1)*d
      call(Field.subtractPositive, [m, y2, y1]);
      call(Field.multiply, [m, m, d]);

      // x3 = m^2 - x1 - x2
      call(Field.square, [tmp, m]);
      call(Field.subtract, [x3, tmp, x1]);
      call(Field.subtract, [x3, x3, x2]);

      // y3 = (x2 - x3)*m - y2
      call(Field.subtractPositive, [y3, x2, x3]);
      call(Field.multiply, [y3, y3, m]);
      call(Field.subtract, [y3, y3, y2]);
    }
  );

  const { R, p } = Field;
  const betaMontgomery = mod(beta * R, p);
  const betaGlobal = implicitMemory.data(Field.bigintToData(betaMontgomery));

  const endomorphism = func(
    { in: [i32, i32], locals: [i32, i32], out: [] },
    ([xOut, x], [yOut, y]) => {
      // compute other pointers from inputs
      local.set(y, i32.add(x, Field.size));
      local.set(yOut, i32.add(xOut, Field.size));

      // x_out = x * beta
      call(Field.multiply, [xOut, x, betaGlobal]);

      // y_out = y
      Field.copyInline(yOut, y);
    }
  );

  return { addAffine, endomorphism };
}
