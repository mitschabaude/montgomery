import { lambda, q } from "../concrete/pasta.js";

let [v1, v2] = egcdStopEarly(lambda, q);
console.log({ v1, v2 });
console.log(v1.a.toString(2).length);
console.log(v1.b.toString(2).length);
console.log(v2.a.toString(2).length);
console.log(v2.b.toString(2).length);

/**
 * Extended Euclidian algorithm which stops when r1 < sqrt(p)
 *
 * Input: positive integers a, p
 * Output: d = gcd(a, p) and x, y satisfying ax + yp = d
 */
function egcdStopEarly(l: bigint, p: bigint) {
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

  let [a1, b1] = [r1, -t1];
  let [a2, b2] = max(r0, abs(t0)) <= max(r2, abs(t2)) ? [r0, -t0] : [r2, -t2];

  // we always have si * p + ti * l = ri
  // => ri + (-ti)*l === 0 (mod p)
  // => we get ai, bi of size ~ sqrt(p), so that ai + bi*l === 0 (mod p)
  return [
    { a: a1, b: b1 },
    { a: a2, b: b2 },
  ];
}

function max(a: bigint, b: bigint) {
  return a > b ? a : b;
}

function abs(x: bigint) {
  return x < 0n ? -x : x;
}
