import {
  $,
  Const,
  Local,
  Type,
  call,
  func,
  global,
  i32,
  i64,
  local,
} from "wasmati";
import { montgomeryParams } from "./helpers.js";
import { modInverse } from "../finite-field-js.js";
import { bigintToLegs } from "../util.js";
import { forLoop1, forLoop4 } from "./wasm-util.js";

export { multiplyMontgomery };

function multiplyMontgomery(
  p: bigint,
  w: number,
  { countMultiplications = false }
) {
  let { n, wn, wordMax } = montgomeryParams(p, w);
  // constants
  let mu = modInverse(-p, 1n << wn);
  let P = bigintToLegs(p, w, n);
  // how much terms we can add before a carry
  let nSafeTerms = 2 ** (64 - 2 * w);
  // how much j steps we can do before a carry:
  let nSafeSteps = 2 ** (64 - 2 * w - 1);

  console.log("multiplyMontgomery", {
    n,
    wn,
    wordMax,
    mu,
    x: p % (1n << wn),
    nSafeTerms,
    nSafeSteps,
  });

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

        // j=0, compute q_i
        let didCarry = false;
        let doCarry = 0 % nSafeSteps === 0;

        // XY[0] + x[i]*y[0]
        local.get(XY[0]);
        i64.mul(xi, Y[0]);
        i64.add();
        // qi = (($ & wordMax) * mu) & wordMax
        if (mu === wordMax) {
          // special case relevant for high 2-adicity curves
          local.set(tmp);
          i64.sub(i64.const(wordMax + 1n), i64.and(tmp, wordMax));
        } else {
          local.tee(tmp);
          i64.and($, wordMax);
          i64.mul($, mu);
          i64.and($, wordMax);
        }
        local.set(qi);
        local.get(tmp);
        // (stack, _) = $ + qi*p[0]
        addMul(qi, P[0]);

        for (let j = 1; j < n - 1; j++) {
          // XY[j] + x[i]*y[j] + qi*p[j], or
          // stack + XY[j] + x[i]*y[j] + qi*p[j]
          // ... = XY[j-1], or  = (stack, XY[j-1])
          didCarry = doCarry;
          doCarry = j % nSafeSteps === 0;
          local.get(XY[j]);
          if (didCarry) i64.add(); // add carry from stack
          i64.mul(xi, Y[j]);
          i64.add();
          addMul(qi, P[j]);
          if (doCarry) {
            // put carry on the stack
            local.tee(tmp);
            i64.shr_u($, wn);
            // mod 2^w the current result
            i64.and(tmp, wordMax);
          }
          local.set(XY[j - 1]);
        }

        let j = n - 1;
        didCarry = doCarry;
        doCarry = j % nSafeSteps === 0;
        if (doCarry) {
          local.get(XY[j]);
          if (didCarry) i64.add(); // add carry from stack
          i64.mul(xi, Y[j]);
          i64.add();
          addMul(qi, P[j]);
          // put carry on the stack
          local.tee(tmp);
          i64.shr_u($, wn);
          // mod 2^w the current result
          i64.and(tmp, wordMax);
          local.set(XY[j - 1]);
          // if the last iteration does a carry, XY[n-1] is set to it
          local.set(XY[j]);
        } else {
          // if the last iteration doesn't do a carry, then XY[n-1] is never set,
          // so we also don't have to get it & can save 1 addition
          i64.mul(xi, Y[j]);
          if (didCarry) i64.add(); // add carry from stack
          addMul(qi, P[j]);
          local.set(XY[j - 1]);
        }
      });
      // outside i loop: final pass of collecting carries
      for (let j = 1; j < n; j++) {
        local.get(xy);
        i32.wrap_i64(i64.and(XY[j - 1], wordMax));
        i32.store({ offset: 4 * (j - 1) });
        i64.shr_u(XY[j - 1], wn);
        local.set(XY[j], i64.add($, XY[j]));
      }
      local.get(xy);
      i32.wrap_i64(XY[n - 1]);
      i32.store({ offset: 4 * (n - 1) });
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

  return { multiply, benchMultiply, multiplyCount, resetMultiplyCount };
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
