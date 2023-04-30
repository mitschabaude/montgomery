import { Field } from "./field-helpers.js";
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
  memory,
  return_,
} from "wasmati";
import { forLoop1 } from "./wasm-util.js";
import { Local } from "wasmati";

export { arithmetic, fieldHelpers };

function arithmetic(Field: Field) {
  // TODO: add/sub/reduce should support to reduce to larger multiples d*p, d > 1

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
            i64.lt_u(tmp, Field.P2[i]);
            br_if(1);
            // if (out[i] !== 2p[i]) break;
            i64.ne(tmp, Field.P2[i]);
            br_if(0);
          });
        });
        // third loop
        // if we're here, t >= 2p, so do t - 2p to get back in 0,..,2p-1
        Field.forEach((i) => {
          // (carry, out[i]) = out[i] - 2p[i] + carry;
          Field.loadLimb(out, i);
          if (i > 0) i64.add(); // add the carry
          i64.sub($, Field.P2[i]);
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
          i64.const(Field.P2[i]);
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

  /**
   * reduce in place from modulo 2*d*p to modulo d*p, i.e.
   * if (x > d*p) x -= d*p
   * (condition: d*p < R = 2^(n*w); we always have d=1 for now but different ones could be used
   * once we try supporting less reductions in add/sub)
   */
  const reduce = func({ in: [i32], locals: [i64], out: [] }, ([x], [tmp]) => {
    // check if x < p
    block(null, () => {
      Field.forEachReversed((i) => {
        // if (x[i] < p[i]) return
        Field.loadLimb(x, i);
        local.tee(tmp);
        i64.lt_u($, Field.P[i]);
        br_if(1);
        // if (x[i] !== p[i]) break;
        i64.ne(tmp, Field.P[i]);
        br_if(0);
      });
    });
    // if we're here, t >= p but we assume t < 2p, so do t - p
    Field.forEach((i) => {
      // (carry, x[i]) = x[i] - p[i] + carry;
      Field.loadLimb(x, i);
      if (i > 0) i64.add(); // add the carry
      i64.sub($, Field.P[i]);
      Field.carry($, tmp);
      Field.storeLimb(x, i, $);
    });
    drop();
  });

  const benchAdd = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(add, [x, x, x]);
      });
    }
  );

  return { add, addNoReduce, subtract, subtractNoReduce, reduce, benchAdd };
}

/**
 * various helpers for finite field arithmetic:
 * isEqual, isZero, isGreater, copy
 */
function fieldHelpers(Field: Field) {
  // x === y
  const isEqual = func({ in: [i32, i32], out: [i32] }, ([x, y]) => {
    Field.forEach((i) => {
      // if (x[i] !== y[i]) return false;
      let xi = Field.loadLimb(x, i);
      let yi = Field.loadLimb(y, i);
      i64.ne(xi, yi);
      if_(null, () => {
        i32.const(0);
        return_();
      });
    });
    // return true;
    i32.const(1);
  });

  // x === 0
  const isZero = func({ in: [i32], out: [i32] }, ([x]) => {
    Field.forEach((i) => {
      // if (x[i] !== 0) return false;
      let xi = Field.loadLimb(x, i);
      i64.ne(xi, 0n);
      if_(null, () => {
        i32.const(0);
        return_();
      });
    });
    // return true;
    i32.const(1);
  });

  // x > y
  const isGreater = func(
    { in: [i32, i32], locals: [i64, i64], out: [i32] },
    ([x, y], [xi, yi]) => {
      block(null, () => {
        Field.forEachReversed((i) => {
          // if (x[i] > y[i]) return true;
          Field.loadLimb(x, i);
          local.tee(xi);
          Field.loadLimb(y, i);
          local.tee(yi);
          i64.gt_u();
          if_(null, () => {
            i32.const(1);
            return_();
          });
          // if (x[i] !== y[i]) break;
          i64.ne(xi, yi);
          br_if(0);
        });
      });
      // return false;
      i32.const(0);
    }
  );

  // copy contents of y into x
  // this should just be inlined if possible
  function copyInline(x: Local<i32>, y: Local<i32>) {
    local.get(x);
    local.get(y);
    i32.const(Field.sizeBytes);
    memory.copy();
  }
  const copy = func({ in: [i32, i32], out: [] }, ([x, y]) => {
    copyInline(x, y);
  });

  return { isEqual, isZero, isGreater, copy, copyInline };
}
