import type * as W from "wasmati";
import {
  $,
  Const,
  Input,
  Local,
  Func,
  Type,
  call,
  func,
  global,
  i32,
  i64,
  local,
} from "wasmati";
import { modInverse, montgomeryParams } from "../field-util.js";
import { bigintToLimbs } from "../util.js";
import { forLoop1, forLoop4 } from "./wasm-util.js";
import { createField } from "./field-helpers.js";
import { FieldWithArithmetic } from "./field-arithmetic.js";

export { multiplyMontgomery, FieldWithMultiply };

type FieldMultiplications = {
  multiply: Func<[i32, i32, i32], []>;
  square: Func<[i32, i32], []>;
  leftShift: Func<[i32, i32, i32], []>;
};
type FieldWithMultiply = FieldWithArithmetic & FieldMultiplications;

function multiplyMontgomery(
  p: bigint,
  w: number,
  { countMultiplications = false }
) {
  let { n, wn, wordMax } = montgomeryParams(p, w);
  const Field = createField(p, w);

  // constants
  let mu = modInverse(-p, 1n << wn);
  let P = bigintToLimbs(p, w, n);
  // how much terms we can add before a carry
  let nSafeTerms = 2 ** (64 - 2 * w);
  // how much j steps we can do before a carry:
  let nSafeSteps = 2 ** (64 - 2 * w - 1);
  let nSafeStepsSquare = Math.floor(2 ** (64 - 2 * w) / 3); // three terms per step

  const multiplyCount = global(Const.i32(0), { mutable: true });

  const resetMultiplyCount = func({ in: [], locals: [], out: [] }, () => {
    global.set(multiplyCount, 0);
  });

  let nLocals = Array<Type<i64>>(n).fill(i64);

  const multiply = func(
    {
      in: [i32, i32, i32],
      locals: [i64, i64, i64, i32, ...nLocals, ...nLocals],
      out: [],
    },
    ([xy, x, y], [tmp, qi, xi, i, ...rest]) => {
      let Y = rest.slice(0, n);
      let XY = rest.slice(n, 2 * n);

      if (countMultiplications) {
        global.set(multiplyCount, i32.add(multiplyCount, 1));
      }

      // load y from memory into locals
      Field.load(y, Y);

      forLoop4(i, 0, n, () => {
        // load x[i] into local
        i32.load({}, i32.add(x, i));
        i64.extend_i32_u();
        local.set(xi);

        // j=0, compute q_i
        let j = 0;
        // XY[0] + x[i]*y[0]
        i64.mul(xi, Y[j]);
        i64.add($, XY[j]);
        // qi = (($ & wordMax) * mu) & wordMax
        local.set(tmp);
        local.set(qi, computeQ(tmp));
        local.get(tmp);
        // (stack, _) = $ + qi*p[0]
        addMul(qi, P[j]);
        i64.shr_u($, wn); // we just put carry on the stack, use it later

        for (j = 1; j < n - 1; j++) {
          // XY[j] + x[i]*y[j] + qi*p[j], or
          // stack + XY[j] + x[i]*y[j] + qi*p[j]
          // ... = XY[j-1], or  = (stack, XY[j-1])
          let didCarry = (j - 1) % nSafeSteps === 0;
          let doCarry = j % nSafeSteps === 0;
          local.get(XY[j]);
          Field.optionalCarryAdd(didCarry);
          i64.mul(xi, Y[j]);
          i64.add();
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
        }

        j = n - 1;
        let didCarry = (j - 1) % nSafeSteps === 0;
        let doCarry = j % nSafeSteps === 0;
        if (doCarry) {
          local.get(XY[j]);
          Field.optionalCarryAdd(didCarry);
          i64.mul(xi, Y[j]);
          i64.add();
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
          // if the last iteration does a carry, XY[n-1] is set to it
          local.set(XY[j]);
        } else {
          // if the last iteration doesn't do a carry, then XY[n-1] is never set,
          // so we also don't have to get it & can save 1 addition
          i64.mul(xi, Y[j]);
          Field.optionalCarryAdd(didCarry);
          addMul(qi, P[j]);
          local.set(XY[j - 1]);
        }
      });

      // final pass of collecting carries, store output in memory
      Field.carryAndStore(xy, XY);
    }
  );

  const square = func(
    { in: [i32, i32], locals: [i64, i64, ...nLocals, ...nLocals], out: [] },
    ([xy, x], [tmp, qi, ...rest]) => {
      let X = rest.slice(0, n);
      let XY = rest.slice(n, 2 * n);

      if (countMultiplications) {
        global.set(multiplyCount, i32.add(multiplyCount, 1));
      }

      // load x from memory into locals
      Field.load(x, X);

      for (let i = 0; i < n; i++) {
        // j=0, compute q_i
        let j = 0;
        // $ = XY[i] + 2*x[0]*x[i]
        if (i === 0) {
          i64.mul(X[i], X[j]);
        } else {
          i64.shl(i64.mul(X[i], X[j]), 1n);
          i64.add($, XY[j]);
        }
        // qi = ($ & wordMax) * mu & wordMax
        local.set(tmp);
        local.set(qi, computeQ(tmp));
        local.get(tmp);
        // ($, _) = $ + qi*p[0]
        addMul(qi, P[0]);
        i64.shr_u($, wn); // we just put carry on the stack, use it later

        for (let j = 1; j < n - 1; j++) {
          // XY[j] + 2*x[i]*x[j] + qi*p[j], or
          // stack + XY[j] + 2*x[i]*x[j] + qi*p[j]
          // ... = XY[j-1], or  = (stack, XY[j-1])
          let didCarry = (j - 1) % nSafeStepsSquare === 0;
          let doCarry = j % nSafeStepsSquare === 0;
          local.get(XY[j]);
          Field.optionalCarryAdd(didCarry);
          if (j <= i) {
            i64.mul(X[i], X[j]);
            if (j < i) i64.shl($, 1n);
            i64.add();
          }
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
        }
        j = n - 1;
        let didCarry = (j - 1) % nSafeStepsSquare === 0;
        let doCarry = j % nSafeStepsSquare === 0;
        if (doCarry) {
          local.get(XY[j]);
          Field.optionalCarryAdd(didCarry);
          if (i === j) {
            i64.mul(X[i], X[j]);
            i64.add();
          }
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
          // if the last iteration does a carry, XY[n-1] is set to it
          local.set(XY[j]);
        } else {
          // if the last iteration doesn't do a carry, then XY[n-1] is never set,
          // so we also don't have to get it & can save 1 addition
          if (i === j) i64.mul(X[i], X[j]);
          i64.mul(qi, P[j]);
          Field.optionalCarryAdd(didCarry);
          if (i === j) i64.add();
          local.set(XY[j - 1]);
        }
      }

      // final pass of collecting carries, store output in memory
      Field.carryAndStore(xy, XY);
    }
  );

  // multiplication by 2^k, where 2^k < 2p
  // TODO: right now, this is implemented exactly like multiply,
  // just that xi is computed instead of loaded from memory.
  // could be at least 50% faster!
  // (all the multiplications by 0 and corresponding adds / carries can be saved,
  // the if loop should only go to (w*n-k) // n, and just do one final round
  // of flexible reduction by 2^(w*n-k % n))
  const leftShift = func(
    {
      in: [i32, i32, i32],
      locals: [i64, i64, i64, i32, i32, i32, ...nLocals, ...nLocals],
      out: [],
    },
    ([xy, y, k], [tmp, qi, xi, i, i0, xi0, ...rest]) => {
      let Y = rest.slice(0, n);
      let XY = rest.slice(n, 2 * n);

      // load y from memory into locals
      Field.load(y, Y);

      // figure out the value of i0, xi0 where 2^k has its bit set
      // i0 = 4 * k // w, xi0 = 2^(k % w)
      local.set(i0, i32.shl(i32.div_u(k, w), 2));
      local.set(xi0, i32.shl(1, i32.rem_u(k, w)));

      forLoop4(i, 0, n, () => {
        // compute x[i]
        local.set(xi, i64.extend_i32_u(i32.mul(i32.eq(i, i0), xi0)));

        // $ = XY[0] + x[i]*y[0]
        let j = 0;
        i64.mul(xi, Y[j]);
        i64.add($, XY[j]);
        // qi = ($ & wordMax) * mu & wordMax
        local.set(tmp);
        local.set(qi, computeQ(tmp));
        local.get(tmp);
        // ($, _) = $ + qi*p[0]
        addMul(qi, P[j]);
        i64.shr_u($, wn); // we just put carry on the stack, use it later

        for (j = 1; j < n - 1; j++) {
          // XY[j] + x[i]*y[j] + qi*p[j], or
          // stack + XY[j] + x[i]*y[j] + qi*p[j]
          // ... = XY[j-1], or  = (stack, XY[j-1])
          let didCarry = (j - 1) % nSafeSteps === 0;
          let doCarry = j % nSafeSteps === 0;
          i64.mul(xi, Y[j]);
          Field.optionalCarryAdd(didCarry);
          i64.add($, XY[j]);
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
        }
        j = n - 1;
        let didCarry = (j - 1) % nSafeSteps === 0;
        let doCarry = j % nSafeSteps === 0;
        if (doCarry) {
          i64.mul(xi, Y[j]);
          Field.optionalCarryAdd(didCarry);
          i64.add($, XY[j]);
          addMul(qi, P[j]);
          Field.optionalCarry(doCarry, $, tmp);
          local.set(XY[j - 1]);
          // if the last iteration does a carry, XY[n-1] is set to it
          local.set(XY[j]);
        } else {
          // if the last iteration doesn't do a carry, then XY[n-1] is never set,
          // so we also don't have to get it & can save 1 addition
          i64.mul(xi, Y[j]);
          Field.optionalCarryAdd(didCarry);
          addMul(qi, P[j]);
          local.set(XY[j - 1]);
        }
      });

      // final pass of collecting carries, store output in memory
      Field.carryAndStore(xy, XY);
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
  const benchSquare = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(square, [x, x]);
      });
    }
  );

  /**
   * compute q(x), the w-bit multiplier for p such that x + q(x) * p = 0 mod 2^w
   *
   * the equation above gives q(x) =  (x % 2^w) * mu % 2^w,
   * where mu = -p^(-1) % 2^w is a precomputed constant.
   *
   * for high 2-adicity curves, we have p = 1 mod 2^w,
   * which implies that mu = 2^w - 1, and the computation simplifies
   */
  function computeQ(x: Input<i64>) {
    // q = ((x & wordMax) * mu) & wordMax, where wordMax = 2^w - 1
    x = i64.and(x, wordMax);
    if (mu === wordMax) {
      // special case relevant for high 2-adicity curves: mu = 2^w - 1
      // (mu * x) % 2^w = -x % 2^w  = 2^w - x
      return i64.sub(wordMax + 1n, x);
    } else {
      return i64.and(i64.mul(x, mu), wordMax);
    }
  }

  return {
    multiply,
    benchMultiply,
    square,
    benchSquare,
    leftShift,
    multiplyCount,
    resetMultiplyCount,
  };
}

function addMul(l: Local<i64>, c: bigint) {
  if (c === 0n) return;
  if (c === 1n) {
    i64.add($, l);
    return;
  }
  i64.mul(l, c);
  i64.add();
}
