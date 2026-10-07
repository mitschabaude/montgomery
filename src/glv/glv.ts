import { abs, assert, divide, log2, max, scale } from "../util.ts";
import { montgomeryParams } from "../bigint/field-util.ts";

export { egcdStopEarly, glvParams, glvScalarParams, type GlvScalarParams };

/**
 * Extended Euclidian algorithm which stops when r1 < sqrt(p)
 *
 * Input: positive integers l, p
 *
 * Output: matrix V = [[v00,v01],[v10,v11]] of field elements satisfying
 * (1, l)^T V = v0j + l*v1j = 0 (mod p) and |vij| ~ sqrt(p) for "random" l
 *
 * Fun fact: the determinant of V is either p or -p. Proof:
 * - initially, det = r0 * t1 - r1 * t0 = p * 1 - l * 0 = p
 * - in each iteration, det flips its sign:
 * det' = r0' * t1' - r1' * t0' =
 * (r1 * (t0 - quotient * t1)) - ((r0 - quotient * r1) * t1) =
 * r1 * t0 - r1 * t1 * quotient - r0 * t1 + quotient * r1 * t1 =
 * r1 * t0 - r0 * t1 = -det
 */
function egcdStopEarly(
  l: bigint,
  p: bigint
): [[bigint, bigint], [bigint, bigint]] {
  if (l > p) throw Error("a > p");
  let [r0, r1] = [p, l];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 * r1 > p) {
    let quotient = r0 / r1; // bigint division, cuts off remainder
    [r0, r1] = [r1, r0 - quotient * r1];
    [s0, s1] = [s1, s0 - quotient * s1];
    [t0, t1] = [t1, t0 - quotient * t1];
  }
  // compute r2, t2
  let quotient = r0 / r1;
  let r2 = r0 - quotient * r1;
  let t2 = t0 - quotient * t1;

  let [v00, v10] = [r1, -t1];
  let [v01, v11] = max(r0, abs(t0)) <= max(r2, abs(t2)) ? [r0, -t0] : [r2, -t2];

  // we always have si * p + ti * l = ri
  // => ri + (-ti)*l === 0 (mod p)
  // => we can use ri as the first row of V and -ti as the second
  return [
    [v00, v01],
    [v10, v11],
  ];
}

/**
 * Parameters of the GLV decomposition s = s0 + s1*lambda (mod q) with scalars
 * in n w-bit limbs, and halves s0, s1 in n0 limbs: the lattice basis V, the
 * rounding constants m0, m1, and the maximum bit length of s0, s1.
 */
function glvParams(q: bigint, lambda: bigint, w: number, n: number) {
  // n0 is the number of limbs we need for scalar halves and intermediate values
  let n0 = Math.ceil(n / 2);
  let m = BigInt(n0 * w);
  let k = BigInt((n - n0) * w);
  assert(k <= m);

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

  return { n0, m, k, v00, v01, v10, v11, m0, m1, maxBits };
}

type GlvScalarParams = {
  q: bigint;
  lambda: bigint;
  w: number;
  n: number;
  n0: number;
  maxBits: number;
};

/** limbs of the GLV scalar module, for scalars in w-bit limbs */
function glvScalarParams(
  q: bigint,
  lambda: bigint,
  w: number
): GlvScalarParams {
  let { n } = montgomeryParams(q, w, 1);
  let { n0, maxBits } = glvParams(q, lambda, w, n);
  return { q, lambda, w, n, n0, maxBits };
}
