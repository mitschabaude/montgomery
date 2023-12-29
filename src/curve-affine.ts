import type * as W from "wasmati"; // for type names
import { MsmField } from "./field-msm.js";
import { randomGenerators } from "./field-util.js";
import type { CurveProjective } from "./curve-projective.js";
import { assert } from "./util.js";

export { createCurveAffine, CurveAffine };

export { getSizeAffine };

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

type CurveAffine = ReturnType<typeof createCurveAffine>;

/**
 * create arithmetic for elliptic curve
 *
 * y^2 = x^3 + b
 *
 * over the `Field`
 */
function createCurveAffine(
  Field: MsmField,
  CurveProjective: CurveProjective,
  b: bigint
) {
  // write b to memory
  let [bPtr] = Field.local.getStablePointers(1);
  Field.writeBigint(bPtr, b);
  Field.toMontgomery(bPtr);

  const { sizeField, square, multiply, add, subtract, copy, memoryBytes, p } =
    Field;

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

  function scale(
    [
      resultProj,
      _ry,
      _rz,
      _rinf,
      pointProj,
      _py,
      _pz,
      _pinf,
      ...scratch
    ]: number[],
    result: number,
    point: number,
    scalar: boolean[]
  ) {
    CurveProjective.affineToProjective(pointProj, point);
    CurveProjective.scale(scratch, resultProj, pointProj, scalar);
    CurveProjective.projectiveToAffine(scratch, result, resultProj);
  }

  function toSubgroupInPlace(
    [tmp, _tmpy, _tmpz, _tmpInf, ...scratch]: number[],
    point: number
  ) {
    if (CurveProjective.cofactor === 1n) return;
    copyAffine(tmp, point);
    scale(scratch, point, tmp, CurveProjective.cofactorBits);
  }

  let { randomFields } = randomGenerators(p);

  /**
   * sample random curve points
   *
   * expects the points as an array of pointers which can hold an affine point
   *
   * strategy: try random x coordinates until one of them fits the curve equation
   * if one doesn't work, increment until it does
   * just use the returned square root
   *
   * if the curve has a cofactor, we multiply by it to get points in the subgroup
   * (in that case, the cofactor multiplication is by far the dominant part)
   */
  function randomPoints(scratch: number[], points: number[]) {
    let n = points.length;
    let xs = randomFields(n);

    for (let i = 0; i < n; i++) {
      let x0 = xs[i];
      let x = points[i];
      let y = x + sizeField;

      // copy x into memory
      Field.writeBigint(x, x0);
      Field.toMontgomery(x);

      while (true) {
        // compute sqrt(x^3 + b), store in y
        square(y, x);
        multiply(y, y, x);
        add(y, y, bPtr);
        let isSquare = Field.sqrt(scratch, y, y);

        // if we didn't find a square root, try again with x+1
        if (isSquare) break;
        add(x, x, Field.constants.mg1);
      }
      setIsNonZero(x, true);
    }

    if (CurveProjective.cofactor !== 1n) {
      for (let i = 0; i < n; i++) {
        toSubgroupInPlace(scratch, points[i]);
      }
    }
    return points;
  }

  function assertOnCurve([y2, y2_]: number[], p: number) {
    let [x, y] = affineCoords(p);
    square(y2, x);
    multiply(y2, y2, x);
    add(y2, y2, bPtr);
    Field.reduce(y2);
    Field.square(y2_, y);
    Field.reduce(y2_);
    assert(Field.isEqual(y2_, y2) === 1, "point on curve");
  }

  function isZero(pointer: number) {
    return !memoryBytes[pointer + 2 * sizeField];
  }

  function copyAffine(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + sizeAffine);
  }

  function affineCoords(pointer: number) {
    return [pointer, pointer + sizeField];
  }

  function setIsNonZero(pointer: number, isNonZero: boolean) {
    memoryBytes[pointer + 2 * sizeField] = Number(isNonZero);
  }

  function toBigint(point: number): BigintPoint {
    if (isZero(point)) return BigintPoint.zero;
    let [x, y] = affineCoords(point);
    Field.fromMontgomery(x);
    Field.fromMontgomery(y);
    let pointBigint = {
      x: Field.readBigint(x),
      y: Field.readBigint(y),
      isInfinity: false,
    };
    Field.toMontgomery(x);
    Field.toMontgomery(y);
    return pointBigint;
  }

  function writeBigint(point: number, { x, y, isInfinity }: BigintPoint) {
    if (isInfinity) {
      setIsNonZero(point, false);
      return;
    }
    let [xPtr, yPtr] = affineCoords(point);
    Field.writeBigint(xPtr, x);
    Field.writeBigint(yPtr, y);
    Field.toMontgomery(xPtr);
    Field.toMontgomery(yPtr);
    setIsNonZero(point, true);
  }

  function batchFromProjective(
    scratch: number[],
    points: number[],
    pointsProj: number[]
  ) {
    let n = points.length;
    assert(n === pointsProj.length, "lengths must match");
    // copy x, y coordinates and collect z coordinates
    using _ = Field.local.atCurrentOffset;
    let zInvs = Field.local.getZeroPointers(n, sizeField);
    let zs = Field.local.getPointers(n, sizeField);
    for (let i = 0; i < n; i++) {
      let xAffine = points[i];
      let yAffine = points[i] + sizeField;
      let [x, y, z] = CurveProjective.projectiveCoords(pointsProj[i]);
      Field.copy(xAffine, x);
      Field.copy(yAffine, y);
      Field.copy(zs[i], z);
    }
    // batch invert z coordinates
    Field.batchInverse(scratch[0], zInvs[0], zs[0], n);
    // x, y <- x/z, y/z
    for (let i = 0; i < n; i++) {
      let x = points[i];
      let y = points[i] + sizeField;
      Field.multiply(x, x, zInvs[i]);
      Field.multiply(y, y, zInvs[i]);
      memoryBytes[x + 2 * sizeField] = 1;
    }
  }

  return {
    b,
    sizeAffine,
    doubleAffine,
    scale,
    toSubgroupInPlace,
    assertOnCurve,
    isZeroAffine: isZero,
    copyAffine,
    affineCoords,
    setIsNonZeroAffine: setIsNonZero,
    toBigint,
    writeBigint,
    batchFromProjective,
    randomPoints,
    randomPointsBigint(n: number, { montgomery = false } = {}) {
      let memoryOffset = Field.getOffset();
      let points = Field.getZeroPointers(n, sizeAffine);
      let scratch = Field.getPointers(20);
      randomPoints(scratch, points);
      let pointsBigint: BigintPoint[] = Array(n);
      for (let i = 0; i < n; i++) {
        let point = points[i];
        let x = point;
        let y = point + sizeField;
        if (!montgomery) {
          Field.fromMontgomery(x);
          Field.fromMontgomery(y);
        } else {
          Field.reduce(x);
          Field.reduce(y);
        }
        pointsBigint[i] = {
          x: Field.readBigint(x),
          y: Field.readBigint(y),
          isInfinity: false,
        };
      }
      Field.setOffset(memoryOffset);
      return pointsBigint;
    },
  };
}

function getSizeAffine(sizeField: number) {
  return 2 * sizeField + 4;
}

type BigintPoint = { x: bigint; y: bigint; isInfinity: boolean };
const BigintPoint = {
  zero: { x: 0n, y: 0n, isInfinity: true },
};
