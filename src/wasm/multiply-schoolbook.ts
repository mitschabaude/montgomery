import type * as W from "wasmati";
import { $, Type, call, func, i32, i64, local } from "wasmati";
import { forLoop1, forLoop4 } from "./wasm-util.js";
import { montgomeryParams } from "../bigint/field-util.js";

export { multiplySchoolbook };

function multiplySchoolbook(p: bigint, w: number) {
  let { n, wn, wordMax } = montgomeryParams(p, w);

  let nLocals = Array<Type<i64>>(n).fill(i64);

  const multiply = func(
    {
      in: [i32, i32, i32],
      locals: [i64, i64, i32, ...nLocals, ...nLocals],
      out: [],
    },
    ([xy, x, y], [tmp, xi, i, ...rest]) => {
      let Y = rest.slice(0, n);
      let XY = rest.slice(n, 2 * n);

      // load y into locals
      for (let i = 0; i < n; i++) {
        i32.load({ offset: i * 4 }, y);
        i64.extend_i32_u();
        local.set(Y[i]);
      }

      forLoop4(i, 0, n, () => {
        // load x[i] into local
        i32.load({}, i32.add(x, i));
        i64.extend_i32_u();
        local.set(xi);

        // XY[0] + x[i]*y[0] is a sum that's finished, and is stored.
        // before storing, we have to do a carry
        local.get(XY[0]);
        i64.mul(xi, Y[0]);
        i64.add();
        local.set(tmp);

        i32.add(xy, i);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({});

        i64.shr_u(tmp, wn);
        local.get(XY[1]);
        i64.add();
        i64.mul(xi, Y[1]);
        i64.add();
        local.set(XY[0]);

        for (let j = 2; j < n - 1; j++) {
          local.get(XY[j]);
          i64.mul(xi, Y[j]);
          i64.add();
          local.set(XY[j - 1]);
        }
      });
      // outside i loop: final pass of carries
      for (let i = n; i < 2 * n; i++) {
        local.set(tmp, local.get(XY[i - n]));
        i64.and(tmp, wordMax);
        i32.wrap_i64();
        i32.store({ offset: 4 * i }, xy, $);
        if (i < 2 * n - 1) {
          local.set(XY[i - n + 1], i64.add(i64.shr_u(tmp, wn), XY[i - n + 1]));
        }
      }
    }
  );

  const benchMultiply = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(multiply, [x, x, x]);
      });
    }
  );

  return { multiply, benchMultiply };
}
