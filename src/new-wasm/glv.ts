import {
  $,
  Func,
  block,
  br_if,
  call,
  control,
  func,
  i32,
  i64,
  local,
} from "wasmati";
import { bigintToLegs } from "../util.js";
import { montgomeryParams } from "./helpers.js";
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
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, r, $);
        local.set(carry, i64.shr_s(tmp, wn));
      }
      local.set(carry, 1n);
      for (let i = 0; i < n; i++) {
        // (carry, l[i]) = l[i] + carry;
        i64.add(i64.extend_i32_u(i32.load({ offset: 4 * i }, l)), carry);
        local.set(tmp);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, l, $);
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

  // negates the scalar in the original scalar field, x = q - x; assuming x < q
  const negateNoReduceDouble = func(
    { in: [i32], locals: [i64, i64], out: [] },
    ([x], [tmp, carry]) => {
      // x = q - x
      for (let i = 0; i < 2 * n; i++) {
        // (carry, x[i]) = q[i] - x[i] + carry;
        i64.add(Q[i], carry);
        i64.extend_i32_u(i32.load({ offset: 4 * i }, x));
        i64.sub();
        local.set(tmp);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, x, $);
        local.set(carry, i64.shr_s(tmp, wn));
      }
    }
  );
  // increments half scalar x without reduction modulo lambda
  const negateFirstHalfNoReduce = func(
    { in: [i32], locals: [i64, i64, i32], out: [] },
    ([s0], [tmp, carry, s1]) => {
      local.set(s1, i32.add(s0, sizeScalar));
      // s0 = lambda - s0
      for (let i = 0; i < n; i++) {
        // (carry, s0[i]) = lambda[i] - s0[i] + carry;
        i64.add(LAMBDA[i], carry);
        i64.extend_i32_u(i32.load({ offset: 4 * i }, s0));
        i64.sub();
        local.set(tmp);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, s0, $);
        local.set(carry, i64.shr_s(tmp, wn));
      }
      // s1 = s1 + 1
      local.set(carry, i64.const(1n));
      for (let i = 0; i < n; i++) {
        // (carry, s1[i]) = s1[i] + carry;
        i64.extend_i32_u(i32.load({ offset: 4 * i }, s1));
        local.get(carry);
        i64.add();
        local.set(tmp);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, s1, $);
        local.set(carry, i64.shr_s(tmp, wn));
      }
    }
  );

  let lambdaShifted = bigintToLegs(lambda << BigInt(lengthP - 1), w, 2 * n);

  const decomposeNoMsb = func(
    { in: [i32], locals: [i32, i32], out: [i32] },
    ([s], [flagNegateBoth, flagNegateFirst]) => {
      // if (s1 > lambda) is possible, do s = q - s, flag both points for negation"
      // TODO: this check is specialized to our limb size, scalar field, lambda
      i32.ge_u(
        i32.load({ offset: 4 * (2 * n - 2) }, s),
        Number(lambdaShifted[2 * n - 2])
      );
      local.tee(flagNegateBoth);
      control.if({}, () => {
        local.get(s);
        call(negateNoReduceDouble);
      });

      // split s = s0 + s1*lambda, where s0 < lambda
      local.get(s);
      call(barrett);
      for (let i = 0; i < e; i++) {
        local.get(s);
        call(reduceByOne);
      }

      // if s0 >= 2^(b-1), do s0 = lambda - s0, s1++, flag first point for negation
      // s0 >= 2^(b-1) is equivalent to (s0 >> (b-1)) === 1
      let msbInHighestLimb = lengthP - 1 - (n - 1) * w;

      // test msb in highest limb
      i32.shr_u(i32.load({ offset: 4 * (n - 1) }, s), msbInHighestLimb);
      local.tee(flagNegateFirst);
      control.if({}, () => {
        local.get(s);
        call(negateFirstHalfNoReduce);
      });

      // return an integer containing flags to negate first / second point

      // negate first?
      i32.xor(flagNegateFirst, flagNegateBoth);
      // negate second? (shift up by 1)
      i32.shl(flagNegateBoth, 1);
      // concatenate
      i32.or();
    }
  );

  return { decompose, decomposeNoMsb };
}
