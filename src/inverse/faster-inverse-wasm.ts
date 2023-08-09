import {
  func,
  Func,
  JSFunction,
  i32,
  i64,
  local,
  memory,
  Module,
  loop,
  block,
} from "wasmati";
import * as Pallas from "../concrete/pasta.js";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.js";
import {
  FieldWithMultiply,
  multiplyMontgomery,
} from "../wasm/multiply-montgomery.js";
import { FieldWithArithmetic } from "../wasm/field-arithmetic.js";
import { memoryHelpers } from "../wasm/memory-helpers.js";

export { almostInverse, helpers };

const { p, w } = Pallas.Field;

let implicitMemory = new ImplicitMemory(memory({ min: 1 << 16 }));

let Field_ = FieldWithArithmetic(p, w);
let { multiply, square, leftShift } = multiplyMontgomery(p, w, {
  countMultiplications: false,
});
const Field = Object.assign(Field_, { multiply, square, leftShift });

let exports = fastInverse(implicitMemory, Field);

let module = Module({
  exports: {
    ...implicitMemory.getExports(),
    ...exports,
  },
});
let wasm = (await module.instantiate()).instance.exports;
const almostInverse = wasm.almostInverse;
let helpers = memoryHelpers(p, w, wasm);

function fastInverse(implicitMemory: ImplicitMemory, Field: FieldWithMultiply) {
  const bitLength = func({ in: [i32], out: [i32] }, ([x], [length]) => {});

  const almostInverse = func(
    {
      in: [i32, i32, i32],
      locals: [i32, i32, i32, i32, i64, i64, i64, i64, i64, i64, i64, i64],
      out: [],
    },
    ([v, s, a], [u, r, i, k, uhi, vhi, ulo, vlo, f0, g0, f1, g1]) => {
      // setup locals
      local.set(u, i32.add(v, Field.size));
      local.set(r, i32.add(s, Field.size));

      // u = p, v = a, r = 0, s = 1
      Field.i32.store(u, Field.i32.P);
      Field.copyInline(v, a);
      Field.i32.store(r, Field.i32.Zero);
      Field.i32.store(s, Field.i32.One);

      block(null, ($block) => {
        forLoop1(i, 0, 2 * Field.n, () => {
          local.set(f0, 1n);
          local.set(g0, 0n);
          local.set(f1, 0n);
          local.set(g1, 1n);
        });
      });
    }
  );

  return { almostInverse };
}
