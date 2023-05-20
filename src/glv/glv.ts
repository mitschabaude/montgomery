import { lambda, q, randomScalar } from "../concrete/pasta.js";
import { mod, montgomeryParams } from "../field-util.js";
import { divide, log2, scale } from "../util.js";
import assert from "node:assert";

let [[v00, v10], [v01, v11]] = egcdStopEarly(lambda, q);

console.log({
  v00: abs(v00).toString(16),
  v01: abs(v01).toString(16),
  v10: abs(v10).toString(16),
  v11: abs(v11).toString(16),
});

/**
 * we write s = s0 + s1 * lambda, where
 * s0 = x0 v00 + x1 v01 + s
 * s1 = x0 v10 + x1 v11
 *
 * x0, x1 are chosen as integer approximations to the rational solutions of
 * x0* v00 + x1* v01 = -s
 * x0* v10 + x1* v11 = 0
 *
 * define the error e = |x0 - x0*| + |x1 - x1*|
 * and v = max(|v00|, |v01|, |v10|, |v11|) ~ sqrt(q)
 *
 * making e small ensures that s0, s1 are small since
 * |s0| = |(x0 - x0*) v00 + (x1 - x1*) v01| <= v * e
 * |s1| = |(x0 - x0*) v10 + (x1 - x1*) v11| <= v * e
 */

const w = 29;
let { n, lengthP: lengthQ } = montgomeryParams(q, w);
let n0 = Math.ceil(n / 2);
let m = BigInt(n0 * w);
// let k = BigInt((n - n0) * w);
let k = BigInt(lengthQ) - m;

let det = v00 * v11 - v10 * v01;
let m0 = ((1n << (m + k)) * -v11) / det;
let m1 = ((1n << (m + k)) * v10) / det;

console.log({
  m,
  k,
  maxBitsV: Math.max(log2(v00), log2(v01), log2(v10), log2(v11)),
  maxBitsM: Math.max(log2(m0), log2(m1)),
  maxBitsSHi: lengthQ - Number(k),
  m0: m0.toString(16),
  m1: m1.toString(16),
});

// s0, s1 upper bounds
let m0Residual = ((1n << (m + k)) * -v11) % det;
let m1Residual = ((1n << (m + k)) * v10) % det;

assert(m0 * det + m0Residual === (1n << (m + k)) * -v11);
assert(m1 * det + m1Residual === (1n << (m + k)) * v10);

let m0Error = Math.abs(divide(m0Residual, det));
let m1Error = Math.abs(divide(m1Residual, det));

console.log({ m0Error, m1Error });

let x0Error = 1 + divide(m0, 1n << m) + m0Error * divide(q, 1n << (m + k));
let x1Error = 1 + divide(m1, 1n << m) + m1Error * divide(q, 1n << (m + k));

console.log({ x0Error, x1Error });

let maxS0Est = scale(x0Error, abs(v00)) + scale(x1Error, abs(v01));
let maxS1Est = scale(x0Error, abs(v10)) + scale(x1Error, abs(v11));

console.log({ maxS0: maxS0Est.toString(16), maxS1: maxS1Est.toString(16) });
console.log({
  maxBitsS0: log2(maxS0Est),
  maxBitsS1: log2(maxS1Est),
});

const Ntest = 100000;
let maxS0 = 0n;
let maxS1 = 0n;
let maxX = 0n;

for (let i = 0; i < Ntest; i++) {
  // random scalar
  let s = randomScalar();

  let x0 = (m0 * (s >> k)) >> m;
  let x1 = (m1 * (s >> k)) >> m;

  let s0 = v00 * x0 + v01 * x1 + s;
  let s1 = v10 * x0 + v11 * x1;

  assert(mod(s0 + s1 * lambda, q) === s);

  if (abs(s0) > maxS0) maxS0 = abs(s0);
  if (abs(s1) > maxS1) maxS1 = abs(s1);
  if (abs(x0) > maxX) maxX = abs(x0);
  if (abs(x1) > maxX) maxX = abs(x1);
}
assert(maxS0 < maxS0Est);
assert(maxS1 < maxS1Est);
console.log({
  maxS0: maxS0.toString(16),
  maxS1: maxS1.toString(16),
  maxX: maxX.toString(16),
});
console.log({
  maxBitsX: log2(maxX),
  maxBitsS0: log2(maxS0),
  maxBitsS1: log2(maxS1),
});

/**
 * Extended Euclidian algorithm which stops when r1 < sqrt(p)
 *
 * Input: positive integers l, p
 * Output: v0 and v1 \in Z^2 satisfying vi[0] + l*vi[1] = 0 (mod p) and |vij| ~ sqrt(p) for "random" l
 */
function egcdStopEarly(l: bigint, p: bigint) {
  if (l > p) throw Error("a > p");
  let [r0, r1] = [p, l];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 * r1 > p) {
    let quotient = r0 / r1; // bigint division, cuts off remainder
    // det' = r0' * t1' - r1' * t0' =
    // (r1 * (t0 - quotient * t1)) - ((r0 - quotient * r1) * t1) =
    // r1 * t0 - r1 * t1 * quotient - r0 * t1 + quotient * r1 * t1 =
    // r1 * t0 - r0 * t1 = -det
    // => det' = -det = +-p
    [r0, r1] = [r1, r0 - quotient * r1];
    [s0, s1] = [s1, s0 - quotient * s1];
    [t0, t1] = [t1, t0 - quotient * t1];
  }
  // compute r2, t2
  let quotient = r0 / r1;
  let r2 = r0 - quotient * r1;
  let t2 = t0 - quotient * t1;

  let [a1, b1] = [r1, -t1];
  let [a2, b2] = max(r0, abs(t0)) <= max(r2, abs(t2)) ? [r0, -t0] : [r2, -t2];

  // we always have si * p + ti * l = ri
  // => ri + (-ti)*l === 0 (mod p)
  // => we get ai, bi of size ~ sqrt(p), so that ai + bi*l === 0 (mod p)
  return [
    [a1, b1],
    [a2, b2],
  ];
}

function max(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function abs(x: bigint) {
  return x < 0n ? -x : x;
}
