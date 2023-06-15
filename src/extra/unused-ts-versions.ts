import { MsmField } from "../field-msm.js";

/**
 * @param scratch
 * @param invX inverted fields of at least length n
 * @param X fields to invert, at least length n
 * @param n length
 */
function batchInverseJs(
  [I, tmp]: number[],
  invX: number,
  X: number,
  n: number,
  { multiply, inverse, sizeField: size }: MsmField
) {
  if (n === 0) return;
  if (n === 1) {
    inverse(tmp, invX, X);
    return;
  }
  let N = n * size;
  // invX = [_, x0*x1, ..., x0*....*x(n-2), x0*....*x(n-1)]
  // invX[i] = x0*...*xi
  multiply(invX + size, X + size, X);
  for (let i = 2 * size; i < N; i += size) {
    multiply(invX + i, invX + i - size, X + i);
  }
  // I = 1/(x0*....*x(n-1)) = 1/invX[n-1]
  inverse(tmp, I, invX + N - size);

  for (let i = N - size; i > size; i -= size) {
    multiply(invX + i, invX + i - size, I);
    multiply(I, I, X + i);
  }
  // now I = 1/(x0*x1)
  multiply(invX + size, X, I);
  multiply(invX, I, X + size);
}
