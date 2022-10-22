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

import { montgomeryParams } from "./finite-field-generate.js";
import { randomBaseFieldx4 } from "./finite-field-js.js";
import { bigintFromLegs, bigintToLegs } from "./util.js";

// reducing base fields
let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
let w = 30;

let { n, lengthP: b } = montgomeryParams(p, w);
let k = b - 1;
let N = n * w;
let K = k + N;

let { n0, e0 } = findMsbCutoff(p, w);
console.log({ n0, e0 });

// number of muls needed for multiplyMsb
let msb = n * n - (n0 * (n0 + 1)) / 2;
console.log({ msb, total: n * n, relative: msb / (n * n) });

const m = 2n ** BigInt(k + N) / p;
const m_vec = bigintToLegs(m, w, n);
const p_vec = bigintToLegs(p, w, n);
const R = 1n << BigInt(N);

// compute x mod p

let x = randomBaseFieldx4() * randomBaseFieldx4();
let x_all = bigintToLegs(x, w, 2 * n);
let x_hi = extractHighBits(x_all, { k, n, w });

let x_hi1 = bigintFromLegs(x_hi, w, n);
console.assert(x_hi1 === x >> BigInt(k), "x_hi");

let l_vec = multiplyMsb(x_hi, m_vec, { n0, n, w });

let l1 = (x_hi1 * m) >> BigInt(N);
let l0 = bigintFromLegs(l_vec, w, n);
console.assert(l1 === l0, "l0 === l1");
console.assert(l0 < R, "l0 < R");

let lp_vec = multiplyLsb(l_vec, p_vec, { w, n });

let lp0 = bigintFromLegs(lp_vec, w, n);
let lp1 = l1 * p - (((l1 * p) >> BigInt(N)) << BigInt(N));
console.assert(lp0 === lp1, "lp0 === lp1");

let r_vec = barrett(x_all, { w, n, n0, m_vec, p_vec });

let r = bigintFromLegs(r_vec, w, n);
console.assert(r < 3n * p, "r < 3p");
console.assert((x - r) % p === 0n, "r === x mod p");
let e = (r - (r % p)) / p;
console.assert(e <= 2n, "e <= 2");
console.log({ e });

function barrett(x, { w, n, n0, m_vec, p_vec }) {
  let x_hi = extractHighBits(x, { k, n, w });
  let l = multiplyMsb(x_hi, m_vec, { n0, n, w });
  let lp = multiplyLsb(l, p_vec, { w, n });
  let x_lo = x.slice(0, n);
  let r = subtractNoReduce(x_lo, lp, { w, n });
  return r;
}

function findMsbCutoff(p, w) {
  let { n, lengthP: b } = montgomeryParams(p, w);
  let k = b - 1;
  let N = n * w;
  let K = k + N;
  let s = 2;
  console.assert(b + 2 * s + 1 <= N);

  let m = 2n ** BigInt(K) / p; // this is bigint division => rounding down

  // let's construct a conservatively bad x_hi (with large lower limbs)
  let x_hi = 2n ** BigInt(2 * b + 2 * s - k) - 1n;

  let m_ = bigintToLegs(m, w, n);
  let x_ = bigintToLegs(x_hi, w, n);

  // construct the length 2N schoolbook multiplication output, without carries
  let t = schoolbook(m_, x_, { n });

  // find the maximal n0 <= n so that t[0..n0] (when interpreted as an integer) is smaller than 2^N
  let n0 = 0;
  for (let sum = 0n; n0 < 2 * n; n0++) {
    sum += t[n0] << BigInt(n0 * w);
    if (sum >= 1n << BigInt(N)) break;
  }

  // confirm the approx. is fine
  let l = (m * x_hi) >> BigInt(N);
  let l0 = bigintFromLegs(multiplyMsb(m_, x_, { n0, n, w }), w, n);

  if (l - l0 > 1n) throw Error("didn't work");
  return { n0, e0: Number(l - l0) };
}

// compute approx. to (x*y) >> 2^n, where x,y < 2^n,
// by neglecting the first i0 output limbs
function multiplyMsb(x, y, { n0, n, w }) {
  let t = new BigUint64Array(2 * n - n0);
  for (let i = 0; i < n; i++) {
    // i + j >= i0 ==> j >= i0 - i
    for (let j = Math.max(0, n0 - i); j < n; j++) {
      t[i + j - n0] += x[i] * y[j];
    }
  }
  carry(t, { w, n: 2 * n - n0 });
  return t.slice(n - n0, 2 * n - n0);
}

// compute x*y - (x*y >> 2^n) = (x*y)[0..n], where x,y < 2^n, i.e. the lower half
function multiplyLsb(x, y, { n, w }) {
  let t = new BigUint64Array(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) {
      t[i + j] += x[i] * y[j];
    }
  }
  carry(t, { w, n });
  return t;
}

function carry(t, { w, n }) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  for (let i = 0; i < n - 1; i++) {
    let carry = t[i] >> wn;
    t[i] &= wordMax;
    t[i + 1] += carry;
  }
  t[n - 1] &= wordMax;
}

function schoolbook(x, y, { n }) {
  let t = new BigUint64Array(2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      t[i + j] += x[i] * y[j];
    }
  }
  return t;
}

/**
 *
 * @param {BigUint64Array} x
 * @param {*} param1
 */
function extractHighBits(x, { k, n, w }) {
  // input x in [0, 2^(n*w + k)) as 2n limbs, where (n-1)*w < k < n*w
  // output: (x >> k) in [0, 2^N) as n limbs
  let x_hi = x.slice(n - 1, 2 * n); // x >> (n-1)*w
  let wordMax = (1n << BigInt(w)) - 1n;
  let k0 = BigInt(k - (n - 1) * w);
  let l = BigInt(w) - k0;
  for (let i = 0; i < n; i++) {
    x_hi[i] = (x_hi[i] >> k0) | ((x_hi[i + 1] << l) & wordMax);
  }
  // since x < 2^(n*w + k), x_hi[n] = x[2n - 1] < 2^(n*w + k - (2*n - 1)*w)) = 2^(k0)
  // x_hi[n] >> k0 = 0
  return x_hi.slice(0, n);
}

function subtractNoReduce(x, y, { w, n }) {
  let wn = BigInt(w);
  let wordMax = (1n << wn) - 1n;
  let carry = 1n;
  let t = new BigUint64Array(n);
  for (let i = 0; i < n; i++) {
    let tmp = x[i] + (wordMax - y[i]) + carry;
    carry = tmp >> wn;
    t[i] = tmp & wordMax;
  }
  return t;
}
