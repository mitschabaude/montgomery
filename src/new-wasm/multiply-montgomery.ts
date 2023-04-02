import {
  Const,
  Local,
  Type,
  br_if,
  call,
  func,
  global,
  i32,
  i64,
  local,
  loop,
} from "wasmati";
import { montgomeryParams } from "./helpers.js";
import { modInverse } from "../finite-field-js.js";
import { bigintToLegs } from "../util.js";

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

  const multiplyCount = global(Const.i32(0), { mutable: true });
  const resetMultiplyCount = func({ in: [], locals: [], out: [] }, () => {
    i32.const(0);
    global.set(multiplyCount);
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
      let S = rest.slice(n, 2 * n);

      if (countMultiplications) {
        global.get(multiplyCount);
        i32.const(1);
        i32.add();
        global.set(multiplyCount);
      }

      // load y
      for (let i = 0; i < n; i++) {
        local.get(y);
        i32.load({ offset: i * 4 });
        i64.extend_i32_u();
        local.set(Y[i]);
      }

      forLoop4(i, 0, n, () => {
        // load x[i] into local
        local.get(x);
        local.get(i);
        i32.add();
        i32.load({});
        i64.extend_i32_u();
        local.set(xi);

        // j=0, compute q_i
        let didCarry = false;
        let doCarry = 0 % nSafeSteps === 0;

        // S[0] + x[i]*y[0]
        local.get(S[0]);
        local.get(xi);
        local.get(Y[0]);
        i64.mul();
        i64.add();
        // qi = (($ & wordMax) * mu) & wordMax
        local.tee(tmp);
        i64.const(wordMax);
        i64.and();
        i64.const(mu);
        i64.mul();
        i64.const(wordMax);
        i64.and();
        local.set(qi);
        local.get(tmp);
        // (stack, _) = $ + qi*p[0]
        local.get(qi);
        i64.const(P[0]);
        i64.mul();
        i64.add();

        for (let j = 1; j < n - 1; j++) {
          // S[j] + x[i]*y[j] + qi*p[j], or
          // stack + S[j] + x[i]*y[j] + qi*p[j]
          // ... = S[j-1], or  = (stack, S[j-1])
          didCarry = doCarry;
          doCarry = j % nSafeSteps === 0;
          local.get(S[j]);
          if (didCarry) i64.add(); // add carry from stack
          local.get(xi);
          local.get(Y[j]);
          i64.mul();
          i64.add();
          local.get(qi);
          i64.const(P[j]);
          i64.mul();
          i64.add();
          if (doCarry) {
            // put carry on the stack
            local.tee(tmp);
            i64.const(wn);
            i64.shr_u();
            // mod 2^w the current result
            local.get(tmp);
            i64.const(wordMax);
            i64.and();
          }
          local.set(S[j - 1]);
        }

        let j = n - 1;
        didCarry = doCarry;
        doCarry = j % nSafeSteps === 0;
        if (doCarry) {
          local.get(S[j]);
          if (didCarry) i64.add(); // add carry from stack
          local.get(xi);
          local.get(Y[j]);
          i64.mul();
          i64.add();
          local.get(qi);
          i64.const(P[j]);
          i64.mul();

          i64.add();
          // put carry on the stack
          local.tee(tmp);
          i64.const(wn);
          i64.shr_u();
          // mod 2^w the current result
          local.get(tmp);
          i64.const(wordMax);
          i64.and();
          local.set(S[j - 1]);
          // if the last iteration does a carry, S[n-1] is set to it
          local.set(S[j]);
        } else {
          // if the last iteration doesn't do a carry, then S[n-1] is never set,
          // so we also don't have to get it & can save 1 addition
          local.get(xi);
          local.get(Y[j]);
          i64.mul();
          if (didCarry) i64.add(); // add carry from stack
          local.get(qi);
          i64.const(P[j]);
          i64.mul();

          i64.add();
          local.set(S[j - 1]);
        }
      });
      // outside i loop: final pass of collecting carries
      for (let j = 1; j < n; j++) {
        local.get(xy);
        local.get(S[j - 1]);
        i64.const(wordMax);
        i64.and();
        i32.wrap_i64();
        i32.store({ offset: 4 * (j - 1) });

        local.get(S[j]);
        local.get(S[j - 1]);
        i64.const(wn);
        i64.shr_u();
        i64.add();
        local.set(S[j]);
      }
      local.get(xy);
      local.get(S[n - 1]);
      i32.wrap_i64();
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

// helper
function forLoop(
  incr: number,
  i: Local<i32>,
  start: number | Local<i32>,
  end: number | Local<i32>,
  callback: () => void
) {
  if (typeof start === "number") i32.const(start);
  else local.get(start);
  local.set(i);
  loop({}, () => {
    callback();
    // i += incr
    local.get(i);
    i32.const(incr);
    i32.add();
    local.tee(i);
    // (...) !== end
    if (typeof end === "number") {
      i32.const(incr * end);
    } else {
      if (incr === 1) {
        local.get(end);
      } else {
        i32.const(incr);
        local.get(end);
        i32.mul();
      }
    }
    i32.ne();
    // if (...) continue
    br_if(0);
  });
}

function forLoop4(
  i: Local<i32>,
  start: number | Local<i32>,
  end: number | Local<i32>,
  callback: () => void
) {
  forLoop(4, i, start, end, callback);
}
function forLoop1(
  i: Local<i32>,
  start: number | Local<i32>,
  end: number | Local<i32>,
  callback: () => void
) {
  forLoop(1, i, start, end, callback);
}
