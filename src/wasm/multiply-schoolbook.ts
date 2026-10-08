import type * as W from "wasmati";
import { localArray, $, call, func, i32, i64, local } from "wasmati";
import { forLoop1, forLoop4 } from "./wasm-util.ts";

export { multiplySchoolbook };

function multiplySchoolbook(p: bigint, w: number, n: number) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;

  const multiply = func(
    {
      in: [{ xy: i32 }, { x: i32 }, { y: i32 }],
      locals: {
        tmp: i64,
        xi: i64,
        i: i32,
        Y: localArray(i64, n),
        XY: localArray(i64, n),
      },
      out: [],
    },
    ({ xy, x, y }, { tmp, xi, i, Y, XY }) => {
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
        i32.store(
          { offset: 4 * i },
          local.get(xy),
          i32.wrap_i64(i64.and(tmp, wordMax))
        );
        if (i < 2 * n - 1) {
          local.set(XY[i - n + 1], i64.add(i64.shr_u(tmp, wn), XY[i - n + 1]));
        }
      }
    }
  );

  const benchMultiply = func(
    { in: [{ x: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
    ({ x, N }, { i }) => {
      forLoop1(i, 0, N, () => {
        call(multiply, { xy: x, x, y: x });
      });
    }
  );

  return { multiply, benchMultiply };
}
