import { inverse } from "./finite-field.js";
import { multiply, copy } from "./finite-field.28.gen.wat.js";

export { batchInverseInPlace };

/**
 * @param {number[]} scratch
 * @param {number[]} tmpX tmp pointers of same length as X
 * @param {number[]} X
 */
function batchInverseInPlace([invProd, ...scratch], tmpX, X) {
  let n = X.length;
  // tmpX = [x0, x0*x1, ..., x0*....*x(n-2), x0*....*x(n-1)]
  // tmpX[i] = x0*...*xi
  copy(tmpX[0], X[0]);
  for (let i = 1; i < n; i++) {
    multiply(tmpX[i], tmpX[i - 1], X[i]);
  }
  // X[0] = 1/(x0*....*x(n-1)) = 1/tmpX[n-1]
  inverse(scratch, invProd, tmpX[n - 1]);

  // X = [garbage, 1/x0, 1/(x0*x1), ..., 1/(x0*....*x(n-2))] (X[i] = 1/(x0*...*x(i-1)))
  // by X[n-1] = invProd * X[n-1], X[i] = X[i+1] * X[i], i >= 1
  // (x0 is not needed for this computation)
  multiply(X[n - 1], invProd, X[n - 1]);
  for (let i = n - 2; i >= 1; i--) {
    multiply(X[i], X[i + 1], X[i]);
  }
  // X = [1/x0, 1/x1, ..., 1/(x(n-1))]
  // by X[0] = X[1],
  // X[i] = 1/xi = (x0*...*x(i-1)) / (x0*...*x(i-1)*xi) = tmpX[i-1] * X[i+1], 1 <= i <= n-2
  // X[n-1] = tmpX[n-2] * invProd
  copy(X[0], X[1]);
  for (let i = 1; i < n - 1; i++) {
    multiply(X[i], tmpX[i - 1], X[i + 1]);
  }
  multiply(X[n - 1], tmpX[n - 2], invProd);
}
