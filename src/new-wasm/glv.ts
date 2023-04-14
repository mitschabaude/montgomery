import {
  $,
  Func,
  Type,
  block,
  br_if,
  call,
  func,
  i32,
  i64,
  local,
} from "wasmati";
import { bigintFromLegs, bigintToLegs } from "../util.js";
import { montgomeryParams } from "./helpers.js";
import { forLoop1 } from "./wasm-util.js";
import { barrettError } from "./barrett.js";

export { glv };

function glv(q: bigint, lambda: bigint, w: number, barrett: Func<[i32], []>) {
  let { n, wordMax, lengthP, wn } = montgomeryParams(lambda, w);
  let k = lengthP - 1;
  let N = n * w;
  let m = 2n ** BigInt(k + N) / lambda;
  let LAMBDA = bigintToLegs(lambda, w, n);
  let Q = bigintToLegs(q, w, 2 * n);
  let sizeScalar = 4 * n;

  // let's compute the maximum error in barrett reduction
  // scalars are < q, which is slightly larger than lambda^2
  let dSquare = q / lambda ** 2n + 1n;
  let e = Math.ceil(barrettError({ k, lambda, dSquare, N, m }));
  if (e > 1) {
    console.warn("WARNING: barrett error of approximating l can be > 1");
  }
  // e is how often we have to reduce by lambda if we want a decomposition x = x0 + lambda * x1 with x0 < lambda

  const reduceByOne = func(
    { in: [i32], locals: [i64, i64, i32], out: [] },
    ([r], [tmp, carry, l]) => {
      local.set(l, i32.add(r, sizeScalar));

      // check if r < lambda
      block({}, () => {
        for (let i = n - 1; i >= 0; i--) {
          // if (r[i] < lambda[i]) return
          local.set(tmp, i64.extend_i32_u(i32.load({ offset: 4 * i }, r)));
          i64.lt_u(tmp, LAMBDA[i]);
          br_if(1);
          // if (r[i] !== lambda[i]) break;
          i64.ne(tmp, LAMBDA[i]);
          br_if(0);
        }
      });

      // if we're here, r >= lambda so do r -= lambda and also l += 1
      local.set(carry, 0n);
      for (let i = 0; i < n; i++) {
        // (carry, r[i]) = r[i] - lambda[i] + carry;
        i64.add(i64.extend_i32_u(i32.load({ offset: 4 * i }, r)), carry);
        i64.const(LAMBDA[i]);
        i64.sub();
        local.set(tmp);
        local.get(r);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i });
        local.set(carry, i64.shr_s(tmp, wn));
      }
      local.set(carry, 1n);
      for (let i = 0; i < n; i++) {
        // (carry, l[i]) = l[i] + carry;
        i64.add(i64.extend_i32_u(i32.load({ offset: 4 * i }, l)), carry);
        local.set(tmp);
        local.get(l);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i });
        local.set(carry, i64.shr_s(tmp, wn));
      }
    }
  );

  const decompose = func({ in: [i32], locals: [], out: [] }, ([x]) => {
    local.get(x);
    call(barrett);
    for (let i = 0; i < e; i++) {
      local.get(x);
      call(reduceByOne);
    }
  });

  return { decompose };
}
