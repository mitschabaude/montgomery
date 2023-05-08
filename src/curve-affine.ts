import type * as W from "wasmati"; // for type names
import { MsmField } from "./field-msm.js";

export { createCurveAffine };

/**
 * Memory layout of curve points
 * -------------
 *
 * a _field element_ x is represented as n limbs, where n is a parameter that depends on the field order and limb size.
 * in wasm memory, each limb is stored as an `i32`, i.e. takes up 4 bytes of space.
 * (usually only the lowest w bits of each `i32` are filled, where w <= 32 is some configured limb size)
 *
 * an _affine point_ is layed out as `[x, y, isNonZero]` in memory, where x and y are field elements and
 * `isNonZero` is a flag used to track whether a point is zero / the point at infinity.
 * - x, y each have length sizeField = 4*n bytes
 * - `isNonZero` is either 0 or 1, but we nevertheless reserve 4 bytes (one `i32`) of space for it.
 *   this helps ensure that all memory addresses are multiples of 4, a property which is required by JS APIs like
 *   Uint32Array, and which should also make memory accesses more efficient.
 *
 * in code, we represent an affine point by a pointer `p`.
 * a pointer is just a JS `number`, and can be easily passed between wasm and JS.
 * on the wasm side, a number appears as an `i32`, suitable as input to memory load/store operations.
 *
 * from `p`, we obtain pointers to the individual coordinates as
 * ```
 * x = p
 * y = p + sizeField
 * isNonZero = p + 2*sizeField
 * ```
 *
 * for a _projective point_, the layout is `[x, y, z, isNonZero]`.
 * we can obtain x, y from a pointer as before, and
 * ```
 * z = p + 2*sizeField
 * isNonZero = p + 3*sizeField
 * ```
 */
function createCurveAffine(Field: MsmField) {
  const {
    fieldSizeBytes: sizeField,
    square,
    multiply,
    add,
    subtract,
    copy,
    memoryBytes,
  } = Field;

  // an affine point is 2 field elements + 1 int32 for isNonZero flag
  let sizeAffine = 2 * sizeField + 4;

  /**
   * affine EC doubling, H = 2*G
   *
   * assuming d = 1/(2*y) is given, and inputs aren't zero.
   *
   * this supports doubling a point in-place with H === G
   * @param scratch
   * @param H output point
   * @param G input point (x, y)
   * @param d 1/(2y)
   */
  function doubleAffine(
    [m, tmp, x2, y2]: number[],
    H: number,
    G: number,
    d: number
  ) {
    let [x, y] = affineCoords(G);
    let [xOut, yOut] = affineCoords(H);
    // m = 3*x^2*d
    square(m, x);
    add(tmp, m, m); // TODO efficient doubling
    add(m, tmp, m);
    multiply(m, d, m);
    // x2 = m^2 - 2x
    square(x2, m);
    add(tmp, x, x); // TODO efficient doubling
    subtract(x2, x2, tmp);
    // y2 = (x - x2)*m - y
    subtract(y2, x, x2);
    multiply(y2, y2, m);
    subtract(y2, y2, y);
    // H = x2,y2
    copy(xOut, x2);
    copy(yOut, y2);
  }

  function isZeroAffine(pointer: number) {
    return !memoryBytes[pointer + 2 * sizeField];
  }

  function copyAffine(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + sizeAffine);
  }

  function affineCoords(pointer: number) {
    return [pointer, pointer + sizeField];
  }

  function setIsNonZeroAffine(pointer: number, isNonZero: boolean) {
    memoryBytes[pointer + 2 * sizeField] = Number(isNonZero);
  }

  return {
    sizeAffine,
    doubleAffine,
    isZeroAffine,
    copyAffine,
    affineCoords,
    setIsNonZeroAffine,
  };
}
