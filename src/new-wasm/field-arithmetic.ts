import { montgomeryParams } from "./helpers.js";
import { createField } from "./field-helpers.js";
import { $, func, i32, i64, local } from "wasmati";

function arithmetic(p: bigint, w: number) {
  const Field = createField(p, w);

  const add = func(
    { in: [i32, i32, i32], locals: [i64, i64], out: [] },
    ([out, x, y], [tmp, carry]) => {
      // first loop: x + y
      for (let i = 0; i < Field.n; i++) {
        // (carry, out[i]) = x[i] + y[i] + carry;
        let xi = Field.loadLimb(x, i);
        let yi = Field.loadLimb(y, i);
        i64.add(xi, yi);
        i64.add($, carry);
        // split result
        local.tee(tmp);
        i64.const(Field.wn);
        i64.shr_s();
        local.set(carry);
        i64.and(tmp, Field.wordMax);
        Field.storeLimb(out, i, $);
      }
    }
  );
}
