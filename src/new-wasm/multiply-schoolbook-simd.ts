import { $, Type, call, func, i32, i64, i64x2, local, v128 } from "wasmati";
import { montgomeryParams } from "./helpers.js";
import { forLoop1, forLoop4 } from "./wasm-util.js";
import { Local } from "wasmati";

export { multiplySchoolbook };

function multiplySchoolbook(p: bigint, w: number) {
  let { n, wn, wordMax } = montgomeryParams(p, w);
  let nIsEven = n % 2 === 0;
  let vIndices: number[] = [];
  for (let i = 2; i < n - 1; i += 2) {
    vIndices.push(i);
  }
  let lastIndex = n - 1;
  let lastIndices = nIsEven ? [] : [n - 1];
  console.log({ n, lastIndices, vIndices });

  let nLocals = Array<Type<i64>>(n).fill(i64);

  let startLocals = [i64, i64];
  let vLocals = vIndices.map(() => v128);
  let lastLocal = lastIndices.map(() => i64);
  let allLocals = [...startLocals, ...vLocals, ...lastLocal];

  const multiply = func(
    {
      in: [i32, i32, i32],
      locals: [i64, v128, i64, v128, i32, ...allLocals, ...nLocals],
      out: [],
    },
    ([xy, x, y], [tmp, vtmp, xi, xi2, i, ...rest]) => {
      let Ystart = rest.splice(0, 2) as Local<i64>[];
      let [y0, y1] = Ystart;
      let Y = rest.splice(0, vLocals.length) as Local<v128>[];
      let Ylast = rest.splice(0, lastLocal.length) as Local<i64>[];
      let Ysingle = [y0, y1, ...Ylast];

      let XY = rest.splice(0, n) as Local<i64>[];

      // load y into locals
      for (let i of [0, 1]) {
        i32.load({ offset: i * 4 }, y);
        i64.extend_i32_u();
        local.set(Ystart[i]);
      }
      for (let i = 0; i < Y.length; i++) {
        i32.load({ offset: (i + 2) * 4 }, y);
        i64.extend_i32_u();
        i64x2.splat();
        i32.load({ offset: (i + 3) * 4 }, y);
        i64.extend_i32_u();
        i64x2.replace_lane(1);
        local.set(Y[i]);
      }
      for (let ylast of Ylast) {
        i32.load({ offset: lastIndex * 4 }, y);
        i64.extend_i32_u();
        local.set(ylast);
      }

      forLoop4(i, 0, n, () => {
        // load x[i] into local
        i32.load({}, i32.add(x, i));
        i64.extend_i32_u();
        local.tee(xi);
        local.set(xi2, i64x2.splat());

        // XY[0] + x[i]*y[0] is a sum that's finished, and is stored.
        // before storing, we do a carry
        local.get(XY[0]);
        i64.mul(xi, y0);
        i64.add();
        local.set(tmp);

        i32.add(xy, i);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({});

        i64.shr_u(tmp, wn);
        local.get(XY[1]);
        i64.add();
        i64.mul(xi, y1);
        i64.add();
        local.set(XY[0]);

        for (let j = 0; j < Y.length; j++) {
          let k = 2 * j + 2;
          local.get(xi2);
          local.get(Y[j]);
          i64x2.mul();

          local.tee(vtmp);
          i64x2.extract_lane(0);
          local.set(XY[k - 1], i64.add($, XY[k]));

          local.get(vtmp);
          i64x2.extract_lane(1);
          local.set(XY[k], i64.add($, XY[k + 1]));
        }

        if (!nIsEven) {
          i64.mul(xi, Ylast[0]);
          local.set(XY[n - 2], i64.add($, XY[n - 1]));
        }
      });
      // outside i loop: final pass of carries
      for (let i = n; i < 2 * n; i++) {
        local.set(tmp, local.get(XY[i - n]));
        local.get(xy);
        i64.and(tmp, wordMax);
        i32.wrap_i64();
        i32.store({ offset: 4 * i });
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
        local.get(x);
        local.get(x);
        local.get(x);
        call(multiply);
      });
    }
  );

  return { multiply, benchMultiply };
}
