import { montgomeryParams } from "./helpers.js";
import { createField } from "./field-helpers.js";
import {
  $,
  block,
  br_if,
  call,
  drop,
  func,
  i32,
  i64,
  if_,
  local,
  return_,
} from "wasmati";
import { forLoop1 } from "./wasm-util.js";
import { bigintToLegs } from "../util.js";

export { arithmetic };

function arithmetic(p: bigint, w: number) {
  const Field = createField(p, w);
  let P2 = bigintToLegs(2n * p, w, Field.n);

  const addition = (doReduce: boolean) =>
    func(
      { in: [i32, i32, i32], locals: [i64], out: [] },
      ([out, x, y], [tmp]) => {
        // first loop: x + y
        Field.forEach((i) => {
          // (carry, out[i]) = x[i] + y[i] + carry;
          let xi = Field.loadLimb(x, i);
          let yi = Field.loadLimb(y, i);
          i64.add(xi, yi);
          if (i > 0) i64.add();
          Field.carry($, tmp);
          Field.storeLimb(out, i, $);
        });
        drop();
        if (!doReduce) return;
        // second loop: check if we overflowed by checking x + y < 2p
        block(null, () => {
          Field.forEachReversed((i) => {
            // if (out[i] < 2p[i]) return
            local.set(tmp, Field.loadLimb(out, i));
            i64.lt_u(tmp, P2[i]);
            br_if(1);
            // if (out[i] !== 2p[i]) break;
            i64.ne(tmp, P2[i]);
            br_if(0);
          });
        });
        // third loop
        // if we're here, t >= 2p, so do t - 2p to get back in 0,..,2p-1
        Field.forEach((i) => {
          // (carry, out[i]) = out[i] - 2p[i] + carry;
          Field.loadLimb(out, i);
          if (i > 0) i64.add(); // add the carry
          i64.sub($, P2[i]);
          Field.carry($, tmp);
          Field.storeLimb(out, i, $);
        });
        drop();
      }
    );
  const add = addition(true);
  const addNoReduce = addition(false);

  const subtraction = (doReduce: boolean) =>
    func(
      { in: [i32, i32, i32], locals: [i64], out: [] },
      ([out, x, y], [tmp]) => {
        // first loop: x - y
        Field.forEach((i) => {
          // (carry, out[i]) = x[i] - y[i] + carry;
          Field.loadLimb(x, i);
          if (i > 0) i64.add();
          Field.loadLimb(y, i);
          i64.sub();
          Field.carry($, tmp);
          Field.storeLimb(out, i, $);
        });
        if (!doReduce) return drop();
        // check if we underflowed by checking carry === 0 (in that case, we didn't and can return)
        i64.eq($, 0n);
        if_(null, () => return_());
        // second loop
        // if we're here, y > x and out = x - y + R, while we want x - y + 2p
        // so do (out += 2p) and ignore the known overflow of R
        Field.forEach((i) => {
          // (carry, out[i]) = (2*p)[i] + out[i] + carry;
          i64.const(P2[i]);
          if (i > 0) i64.add();
          Field.loadLimb(out, i);
          i64.add();
          Field.carry($, tmp);
          Field.storeLimb(out, i, $);
        });
        drop();
      }
    );

  const subtract = subtraction(true);
  const subtractNoReduce = subtraction(false);

  const benchAdd = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(add, [x, x, x]);
      });
    }
  );

  return { add, addNoReduce, subtract, subtractNoReduce, benchAdd };
}
