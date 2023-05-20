import { lambda, q, randomScalar } from "../concrete/pasta.js";
import { mod, montgomeryParams } from "../field-util.js";
import { abs, divide, log2, scale } from "../util.js";
import assert from "node:assert";
import { egcdStopEarly } from "./glv.js";

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
