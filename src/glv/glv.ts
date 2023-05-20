import { abs, max } from "../util.js";

export { egcdStopEarly };

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
