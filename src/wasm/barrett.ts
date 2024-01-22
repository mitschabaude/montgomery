import { $, Func, Type, call, func, i32, i64, local } from "wasmati";
import { bigintFromLimbs, bigintToLimbs, log2 } from "../util.js";
import { forLoop1 } from "./wasm-util.js";

export { barrettReduction, multiplyBarrett, barrettError, findMsbCutoff };

/**
 * barrett reduction modulo p (may be non-prime)
 *
 * given x, p, find l, r s.t. x = l*p + r
 *
 * l = [x/p] ~= l* = [x*m / 2^K] = x*m >> K, where m = [2^K / p]
 *
 * we always have l* <= l
 *
 * for estimating the error in the other direction,
 * let's assume we can guarantee x < 2^K
 * we have
 * 2^K / p <= [2^K / p] + 1 = m + 1
 * multiplying by (x/2^K) yields
 * x/p <= m*x/2^K + x/2^K < m*x/2^K + 1
 * so we get
 * l = [x/p] <= x/p <= m*x/2^K + 1
 * since l is an integer, we can round down the rhs:
 * l <= l* + 1
 *
 * let w be the limb size, and let x be represented as 2*n*w limbs, and p as n*w limbs
 * set N = n*w
 *
 * write b := Math.ceil(log_2(p)) = number of bits needed to represent p
 *
 * write K = k + N, where we want two conditions:
 * - 2^k < p. so, k < b < N. for example, k = b-1
 *   => m = [2^(k + N) / p] < 2^N, so we can represent m using the same # of limbs
 * - we can guarantee x < 2^(k + N)
 *   => this was the condition above which led to l <= l* + 1
 *
 * for example, if x = a*b, where both a, b < 2^s * p, then x < 2^(2s) * p^2
 *   => taking logs gives a condition on k: 2s + 2b <= k + N
 *   => take k = b-1
 *   => we get 2s + 2b <= b - 1 + N
 *   => condition b + 2s + 1 <= N
 *   typically we can leave a bit of room for s, since N will be a bit larger than b
 *   means a,b don't have to be fully reduced
 *
 * split up x into two unequal parts
 *   x = 2^k (x_hi) + x_lo, where x_lo has the low k bits and x_hi the rest
 * => splitting needs ~2n bitwise ops
 *
 * let's ignore x_lo and just compute l** = (x_hi * m) >> N = [x_hi * m / 2^N] <= l* <= l
 * => x_hi < 2^N, so both m and x_hi have N limbs
 *
 * this gives an approximation error
 * l* <= x*m / 2^(k + N) = x_hi * m / 2^N + (x_lo/2^k)*(m/2^N) < x_hi * m / 2^N + 1
 * and since l* is an integer,
 * l* <= [x_hi * m / 2^N] + 1 = l** + 1
 * so
 * l <= l** + 2
 *
 * to further optimize, note that in (x_hi * m) >> N, we end up ignoring the lower half of the product's 2N limbs
 * so, we can compute the product x_hi * m by ignoring all lower limb combinations which (in combination) are < 2^N.
 * => takes only ~60% of effort compared to a full multiplication
 * => the second multiplication to compute x - l*p can ignore the entire upper half => takes ~50%
 * => so in summary, barrett reduction takes ~1.1 full multiplications
 *
 * if l~ = l - e where e~ <= e, then
 * r~ = x - (l~)p = x - lp + (e~)p = r + (e~)p, with e~ in { 0, ..., e }
 * so, the result r~ is correct modulo p, but is only in [0, (1 + e)p) instead of [0, p).
 * in fewer words, this algorithm computes (x mod e*p).
 * this is similar to montgomery multiplication, and in line with earlier our assumption that x = a*b, where both a, b < 2^s * p.
 *
 * for e = 3 we can choose s=2, so assuming a, b < 4p
 * => c = (a*b mod 3p) < 4p, so again of the same form
 * => can be used without reduction steps in further products (or addition / subtraction steps which accept inputs < 4p)
 *
 * with k = b-1, our previous condition b + 2s + 1 <= N with s=2 implies
 * b + 5 <= N
 */
function barrettReduction(p: bigint, w: number, n: number) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  let k = log2(p) - 1;
  let N = n * w;
  let { n0, e0 } = findMsbCutoff(p, w, n);
  let m = 2n ** BigInt(k + N) / p;
  let M = bigintToLimbs(m, w, n);
  let P = bigintToLimbs(p, w, n);

  let nLocals = Array<Type<i64>>(n).fill(i64);

  return func(
    { in: [i32], locals: [i64, ...nLocals, ...nLocals], out: [] },
    ([x], [tmp, ...rest]) => {
      let L = rest.splice(0, n);
      let LP = rest.splice(0, n);

      // extract x_hi := x >> k = all bits of x except the lowest k
      // x_hi = x.slice(n-1, 2*n) <==> x >> (n - 1)*w
      // then we only have to do x_hi >>= k - (n - 1)*w
      let k0 = BigInt(k - (n - 1) * w);
      let l0 = wn - k0;

      local.set(tmp, i64.extend_i32_u(i32.load({ offset: 4 * (n - 1) }, x)));
      for (let i = 0; i < n; i++) {
        // x_hi[i] = (x_hi[i] >> k0) | ((x_hi[i + 1] << l) & wordMax);
        i64.shr_u(tmp, k0);
        i32.load({ offset: 4 * (i + n) }, x);
        local.tee(tmp, i64.extend_i32_u($));
        i64.shl($, l0);
        i64.and($, wordMax);
        i64.or();
        local.set(L[i]);
      }

      // l = multiplyMsb(x_hi, m) = [x_hi * m / 2^N]
      // compute (x_hi*m) >> 2^N, where x_hi,m < 2^N,
      // by neglecting the first n0 output limbs (which we checked don't contribute in the worst case)
      for (let i = n0; i < 2 * n - 1; i++) {
        for (let j = Math.max(0, i - n + 1); j < Math.min(i + 1, n); j++) {
          i64.mul(L[j], M[i - j]);
          if (!(i === n0 && j === 0)) i64.add();
        }
        if (i < n) i64.shr_u($, wn);
        if (i >= n) {
          local.tee(tmp);
          i64.and($, wordMax);
          local.set(L[i - n]);
          i64.shr_u(tmp, wn);
        }
      }
      local.set(L[n - 1]);

      // lp = multiplyLsb(l, p) = (l*p)[0..n], i.e. just compute the lower half
      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          i64.mul(L[j], P[i - j]);
          if (j !== 0) i64.add();
        }
        local.set(LP[i]);
      }

      // now overwrite the low n limbs with x = x - lp
      // and ignore the possible overflow bit because we know the result fits in N bits
      for (let i = 0; i < n; i++) {
        // (carry, x[i]) = x[i] - LP[i] + carry;
        i64.extend_i32_u(i32.load({ offset: 4 * i }, x));
        if (i > 0) i64.add();
        local.get(LP[i]);
        i64.sub();
        local.set(tmp);
        i32.wrap_i64(i64.and(tmp, wordMax));
        i32.store({ offset: 4 * i }, x, $);
        if (i !== n - 1) i64.shr_s(tmp, wn);
      }
      // overwrite the high n limbs with l
      for (let i = n; i < 2 * n; i++) {
        i32.wrap_i64(local.get(L[i - n]));
        i32.store({ offset: 4 * i }, x, $);
      }
    }
  );
}

function multiplyBarrett(
  p: bigint,
  w: number,
  n: number,
  multiply: Func<[i32, i32, i32], []>
) {
  const barrett = barrettReduction(p, w, n);

  const modularMultiply = func(
    { in: [i32, i32, i32], locals: [], out: [] },
    ([xy, x, y]) => {
      call(multiply, [xy, x, y]);
      call(barrett, [xy]);
    }
  );
  const benchMultiply = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(modularMultiply, [x, x, x]);
      });
    }
  );

  return { multiply: modularMultiply, benchMultiply };
}

// helpers

// compute max error of l in barrett reduction
// TODO document
function barrettError({
  k,
  lambda,
  dSquare,
  N,
  m,
}: {
  k: number;
  lambda: bigint;
  dSquare: bigint;
  N: number;
  m: bigint;
}) {
  let errNumerator =
    m * 2n ** BigInt(k) * lambda +
    BigInt(dSquare) * lambda ** 2n * (2n ** BigInt(k + N) - m * lambda);
  let errDenominator = lambda * 2n ** BigInt(k + N);
  let lengthErr = BigInt(errDenominator.toString().length);
  let err =
    Number(errNumerator / 10n ** (lengthErr - 5n)) /
    Number(errDenominator / 10n ** (lengthErr - 5n));
  return err;
}

function findMsbCutoff(p: bigint, w: number, n: number) {
  let b = log2(p);
  let k = b - 1;
  let N = n * w;
  let K = k + N;
  let s = 2;
  console.assert(b + 2 * s + 1 <= N);

  let m = 2n ** BigInt(K) / p; // this is bigint division => rounding down

  // let's construct a conservatively bad x_hi (with large lower limbs)
  let x_hi = 2n ** BigInt(2 * b + 2 * s - k) - 1n;

  let m_vec = bigintToLimbs(m, w, n);
  let x_vec = bigintToLimbs(x_hi, w, n);

  // construct the length 2N schoolbook multiplication output, without carries
  let t = schoolbook(m_vec, x_vec, { n });

  // find the maximal n0 <= n so that t[0..n0] (when interpreted as an integer) is smaller than 2^N
  let n0 = 0;
  for (let sum = 0n; n0 < 2 * n; n0++) {
    sum += t[n0] << BigInt(n0 * w);
    if (sum >= 1n << BigInt(N)) break;
  }

  // confirm the approximation is fine
  let l = (m * x_hi) >> BigInt(N);
  let l0 = bigintFromLimbs(multiplyMsb(m_vec, x_vec, { n0, n, w }), w, n);

  if (l - l0 > 1n)
    console.warn(
      `WARNING: for n=${n}, w=${w} the max cutoff error is ${l - l0}`
    );
  return { n0, e0: Number(l - l0) };
}

// compute approx. to (x*y) >> 2^N, where x,y < 2^N,
// by neglecting the first n0 output limbs
function multiplyMsb(
  x: bigint[],
  y: bigint[],
  { n0, n, w }: { n0: number; n: number; w: number }
) {
  let t = new BigUint64Array(2 * n - n0);
  for (let i = 0; i < n; i++) {
    // i + j >= n0 ==> j >= n0 - i
    for (let j = Math.max(0, n0 - i); j < n; j++) {
      t[i + j - n0] += x[i] * y[j];
    }
  }
  carry(t, { w, n: 2 * n - n0 });
  return t.slice(n - n0, 2 * n - n0);
}

function schoolbook(x: bigint[], y: bigint[], { n }: { n: number }) {
  let t = new BigUint64Array(2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      t[i + j] += x[i] * y[j];
    }
  }
  return t;
}

function carry(t: BigUint64Array, { w, n }: { n: number; w: number }) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  for (let i = 0; i < n - 1; i++) {
    let carry = t[i] >> wn;
    t[i] &= wordMax;
    t[i + 1] += carry;
  }
  t[n - 1] &= wordMax;
}
