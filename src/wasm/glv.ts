import {
  $,
  AnyFunc,
  Func,
  Input,
  Local,
  Type,
  block,
  br_if,
  call,
  control,
  drop,
  func,
  i32,
  i64,
  if_,
  local,
  unreachable,
} from "wasmati";
import {
  abs,
  assert,
  bigintToLimbs,
  divide,
  log2,
  max,
  scale,
} from "../util.js";
import { barrettError, barrettReduction } from "./barrett.js";
import { egcdStopEarly } from "../glv/glv.js";
import { createField } from "./field-helpers.js";

export { glvSpecial as glv, glvGeneral };

function glvGeneral(q: bigint, lambda: bigint, w: number, n: number) {
  let Field = createField(q, w, n);
  let wn = BigInt(w);
  // n0 is the number of limbs we need for scalar halves and intermediate values
  let n0 = Math.ceil(n / 2);
  let m = BigInt(n0 * w);
  let k = BigInt((n - n0) * w);
  assert(k <= m);

  // constants
  let [[v00, v01], [v10, v11]] = egcdStopEarly(lambda, q);
  let det = v00 * v11 - v10 * v01;
  let m0 = ((1n << (m + k)) * -v11) / det;
  let m1 = ((1n << (m + k)) * v10) / det;

  // check that these fit into our halved number of limbs
  let maxV = max(max(v00, v01), max(v10, v11));
  let limbMax = 1n << m;
  assert(maxV < limbMax);
  assert(m0 < limbMax);
  assert(m1 < limbMax);

  // TODO make these work with an n0 limb representation
  let [m0Sign, M0] = bigintToLimbsPositive(m0, w, n);
  let [m1Sign, M1] = bigintToLimbsPositive(m1, w, n);
  let [v00Sign, V00] = bigintToLimbsPositive(v00, w, n0);
  let [v01Sign, V01] = bigintToLimbsPositive(v01, w, n0);
  let [v10Sign, V10] = bigintToLimbsPositive(v10, w, n0);
  let [v11Sign, V11] = bigintToLimbsPositive(v11, w, n0);

  let nLocals = Array<Type<i64>>(n).fill(i64);
  let n0Locals = Array<Type<i64>>(n0).fill(i64);

  const decompose = func(
    {
      in: [i32, i32, i32],
      // TODO X0, X1 should be n0 limbs
      locals: [i64, ...nLocals, ...n0Locals, ...n0Locals],
      out: [i32],
    },
    ([s0, s1, s], [tmp, ...rest]) => {
      // algorithm at a high level:
      // let x0 = (m0 * (s >> k)) >> m;
      // let x1 = (m1 * (s >> k)) >> m;
      // let s0 = v00 * x0 + v01 * x1 + s;
      // let s1 = v10 * x0 + v11 * x1;

      let S = rest.splice(0, n);
      // s_hi := s >> k = highest n0 limbs of s
      let SHi = S.slice(n - n0, n);

      let X0 = rest.splice(0, n0);
      let X1 = rest.splice(0, n0);

      Field.load(s, S);

      // x0 = ((s >> k) * m0) >> m
      // x1 = ((s >> k) * m1) >> m
      let nSafeTerms = 2 ** (64 - 2 * w);
      let nSafeTermsSigned = 2 ** (63 - 2 * w);
      assert(nSafeTerms >= n0);
      assert(nSafeTermsSigned >= n0);

      multiplyMsb(X0, SHi, M0, tmp, n0, 0);
      multiplyMsb(X1, SHi, M1, tmp, n0, 0);

      let x0Sign = m0Sign;
      let x1Sign = m1Sign;

      // let s0 = v00 * x0 + v01 * x1 + s;
      // let s1 = v10 * x0 + v11 * x1;
      /**
       * z = (x*y)[0..n], where x, y, z all have n limbs
       */
      assert(nSafeTerms >= 2 * n + 1);
      assert(nSafeTermsSigned >= 2 * n + 1);
      for (let i = 0; i < n; i++) {
        local.get(S[i]);
        if (i !== 0) i64.add();
        for (let j = 0; j <= i; j++) {
          i64.mul(X0[j] ?? 0n, V00[i - j] ?? 0n);
          addSigned(x0Sign * v00Sign);
          i64.mul(X1[j] ?? 0n, V01[i - j] ?? 0n);
          addSigned(x1Sign * v01Sign);
        }
        Field.carrySigned($, tmp);
        Field.storeLimb(s0, i, $);
      }

      // if final value on the stack is -1, we have to sign-flip the representation
      local.set(tmp);
      i64.ne(tmp, 0n);
      if_(
        { out: [i32] },
        () => {
          i64.ne(tmp, -1n);
          if_(null, () => unreachable());
          flipSign(s0, tmp, n);
          i32.const(1); // return isNegative flag
        },
        () => i32.const(0)
      );

      for (let i = 0; i < n; i++) {
        i64.const(0n);
        if (i !== 0) i64.add();
        for (let j = 0; j <= i; j++) {
          i64.mul(X0[j] ?? 0n, V10[i - j] ?? 0n);
          addSigned(x0Sign * v10Sign);
          i64.mul(X1[j] ?? 0n, V11[i - j] ?? 0n);
          addSigned(x1Sign * v11Sign);
        }
        Field.carrySigned($, tmp);
        Field.storeLimb(s1, i, $);
      }

      // if final value on the stack is -1, we have to sign-flip the representation
      local.set(tmp);
      i64.ne(tmp, 0n);
      if_(
        { out: [i32] },
        () => {
          i64.ne(tmp, -1n);
          if_(null, () => unreachable());
          flipSign(s1, tmp, n);
          i32.const(1); // return isNegative flag
        },
        () => i32.const(0)
      );

      // combine the two isNegative flags on the stack into one i32 to avoid returning an array
      i32.shl($, 1);
      i32.or();
    }
  );

  function flipSign(x: Local<i32>, xi: Local<i64>, n: number) {
    i64.const(1n);
    for (let i = 0; i < n; i++) {
      i64.sub(Field.wordMax, Field.loadLimb(x, i));
      i64.add();
      Field.carrySigned($, xi);
      Field.storeLimb(x, i, $);
    }
    drop();
  }

  /**
   * z = round(x*y / 2^n*w), where x, y, z all have n limbs
   *
   * can use x === z
   */
  function multiplyMsb(
    Z: Local<i64>[],
    X: Input<i64>[],
    Y: Input<i64>[],
    tmp: Local<i64>,
    n: number,
    n0 = 0
  ) {
    for (let i = n0; i < 2 * n - 1; i++) {
      for (let j = Math.max(0, i - n + 1); j < Math.min(i + 1, n); j++) {
        i64.mul(X[j], Y[i - j]);
        if (!(i === n0 && j === 0)) i64.add();
      }
      if (i < n - 1) i64.shr_u($, wn);
      if (i === n - 1) {
        // test (nw)-1th = ((n-1)w + w-1)th bit of x*y; if set, round up instead of down
        Field.carry($, tmp);
        i64.and($, 1n << (Field.wn - 1n));
        i64.extend_i32_u(i64.ne($, 0n));
        i64.add(); // add 0 or 1 to the carry bit
      }
      if (i >= n) {
        Field.carry($, tmp);
        local.set(Z[i - n]);
      }
    }
    local.set(Z[n - 1]);
  }

  // compute s0, s1 upper bounds
  // s0, s1 upper bounds
  let m0Residual = ((1n << (m + k)) * -v11) % det;
  let m1Residual = ((1n << (m + k)) * v10) % det;
  let m0Error = Math.abs(divide(m0Residual, det));
  let m1Error = Math.abs(divide(m1Residual, det));
  let x0Error = 0.5 + divide(m0, 1n << m) + m0Error * divide(q, 1n << (m + k));
  let x1Error = 0.5 + divide(m1, 1n << m) + m1Error * divide(q, 1n << (m + k));
  let maxS0 = scale(x0Error, abs(v00)) + scale(x1Error, abs(v01));
  let maxS1 = scale(x0Error, abs(v10)) + scale(x1Error, abs(v11));
  let maxBits = Math.max(log2(maxS0), log2(maxS1));

  return { decompose, maxBits, n0 };
}

function addSigned(sign: number) {
  return sign === -1 ? i64.sub() : i64.add();
}

function bigintToLimbsPositive(
  x: bigint,
  w: number,
  n: number
): [sign: 1 | -1, limbs: bigint[]] {
  if (x >= 0) return [1, bigintToLimbs(x, w, n)];
  return [-1, bigintToLimbs(-x, w, n)];
}

/**
 * GLV decomposition in the special case that the cube root of unity lambda has only half the bit length of the scalar field modulus,
 * and we can just use barrett reduction s = s0 + s1*lambda to get small s0, s1
 */
function glvSpecial(q: bigint, lambda: bigint, w: number, n: number) {
  let lengthP = log2(lambda);
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  let k = lengthP - 1;
  let N = n * w;
  let m = 2n ** BigInt(k + N) / lambda;
  let LAMBDA = bigintToLimbs(lambda, w, n);
  let Q = bigintToLimbs(q, w, 2 * n);
  let sizeScalar = 4 * n;

  const barrett = barrettReduction(lambda, w, n);

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
    call(barrett, [x]);
    for (let i = 0; i < e; i++) {
      call(reduceByOne, [x]);
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

  let lambdaShifted = bigintToLimbs(lambda << BigInt(lengthP - 1), w, 2 * n);

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
        call(negateNoReduceDouble, [s]);
      });

      // split s = s0 + s1*lambda, where s0 < lambda
      call(barrett, [s]);
      for (let i = 0; i < e; i++) {
        call(reduceByOne, [s]);
      }

      // if s0 >= 2^(b-1), do s0 = lambda - s0, s1++, flag first point for negation
      // s0 >= 2^(b-1) is equivalent to (s0 >> (b-1)) === 1
      let msbInHighestLimb = lengthP - 1 - (n - 1) * w;

      // test msb in highest limb
      i32.shr_u(i32.load({ offset: 4 * (n - 1) }, s), msbInHighestLimb);
      local.tee(flagNegateFirst);
      control.if({}, () => {
        call(negateFirstHalfNoReduce, [s]);
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

  return { decompose, decomposeNoMsb, barrett };
}
