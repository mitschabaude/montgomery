import { type MsmField } from "./field-msm.ts";
import { assert, bigintToBits } from "./util.ts";
import { randomGenerators } from "./bigint/field-random.ts";
import {
  type BigintPoint,
  type CurveParams,
  createCurveTwistedEdwards as createBigint,
} from "./bigint/twisted-edwards.ts";

export { createCurveTwistedEdwards, type CurveTwistedEdwards };

type CurveTwistedEdwards = ReturnType<typeof createCurveTwistedEdwards>;

/**
 * Operations on a twisted edwards curve, with a = -1
 *
 * -x^2 + y^2 = 1 + d*x^2*y^2
 *
 * The representation uses extended coordinates (X, Y, Z, Z) where
 *
 * x = X/Z
 * y = Y/Z
 * T = XY/Z
 */
function createCurveTwistedEdwards(Field: MsmField, params: CurveParams) {
  const CurveBigint = createBigint(params);
  let { cofactor, d } = params;
  const { sizeField, memoryBytes, p } = Field;

  // memory layout: x | y | z | t
  let size = 4 * sizeField;

  // write d to memory
  let [dPtr, k] = Field.local.getStablePointers(2);
  Field.fromBigint(dPtr, d);
  Field.fromBigint(k, 2n * d);

  // write the zero point to memory
  let [zero] = Field.local.getStablePointers(1, size);
  fromBigint(zero, CurveBigint.zero);

  // convert the cofactor to bits
  let cofactorBits = bigintToBits(cofactor);
  let orderBits = bigintToBits(CurveBigint.order);

  function coords(pointer: number) {
    return [
      pointer,
      pointer + sizeField,
      pointer + 2 * sizeField,
      pointer + 3 * sizeField,
    ];
  }
  function copyPoint(target: number, source: number) {
    Field.copyMemory(target, source, size);
  }

  function isZero(P: number) {
    // P is zero <=> X = 0 and Y = Z
    let X = P;
    Field.reduce(X);
    if (!Field.isZero(X)) return false;

    let Y = X + sizeField;
    let Z = Y + sizeField;
    Field.reduce(Y);
    Field.reduce(Z);
    return !!Field.isEqual(Y, Z);
  }
  function setZero(P: number) {
    copyPoint(P, zero);
  }

  // Additions run in wasm (src/wasm/curve.ts): dedicated formulas, 7M mixed
  // and 8M otherwise, which fall back to the unified 9M formula for P1 = P2.
  // Doubling uses the unified formula. P3 may alias P1 and P2, and scratch
  // must be 9 contiguous field elements.
  // TODO: dedicated doubling

  function negateInPlace(P: number) {
    // get coordinates to negate
    let X = P;
    let T = X + 3 * sizeField;

    // negate X and T
    Field.subtract(X, Field.constants.zero, X);
    Field.subtract(T, Field.constants.zero, T);
  }

  function negate(Q: number, P: number) {
    copyPoint(Q, P);
    negateInPlace(Q);
  }

  /**
   * addition, P3 = P1 + P2
   */
  function add(scratch: number[], P3: number, P1: number, P2: number) {
    Field.addEdwards(scratch[0], P3, P1, P2, k);
  }

  /**
   * addition with assignment, P += Q
   */
  function addAssign(scratch: number[], P: number, Q: number) {
    Field.addEdwards(scratch[0], P, P, Q, k);
  }

  /**
   * subtraction or addition with assignment, depending on the subtract flag
   */
  function addMixed(scratch: number[], R: number, P: number, Q: number) {
    Field.addMixedEdwards(scratch[0], R, P, Q, k);
  }

  /**
   * subtraction or addition with assignment, depending on the subtract flag
   */
  function subMixed(scratch: number[], R: number, P: number, Q: number) {
    Field.subMixedEdwards(scratch[0], R, P, Q, k);
  }

  /**
   * double, P3 = 2*P1
   *
   * TODO: dedicated doubling, saves some operations compared to add
   */
  function double(scratch: number[], P3: number, P1: number) {
    Field.doubleEdwards(scratch[0], P3, P1, P1, k);
  }

  /**
   * Double in place, P *= 2
   *
   * TODO: implement dedicated doubling, saves some operations compared to add
   * squares instead of multiplies etc
   */
  function doubleInPlace(scratch: number[], P: number) {
    Field.doubleEdwards(scratch[0], P, P, P, k);
  }

  /**
   * Scalar multiplication
   */
  function scale(
    [P, _py, _pz, _pt, ...scratch]: number[],
    result: number,
    scalar: boolean[],
    point: number
  ) {
    let n = scalar.length;
    copyPoint(P, point);

    if (scalar[n - 1]) copyPoint(result, P);
    else copyPoint(result, zero);

    for (let i = n - 2; i >= 0; i--) {
      doubleInPlace(scratch, result);
      if (scalar[i]) addAssign(scratch, result, P);
    }
  }

  function toSubgroupInPlace(scratch: number[], point: number) {
    if (cofactor === 1n) return;
    scale(scratch, point, cofactorBits, point);
  }

  function isInSubgroup(
    [zero, _y, _z, _t, ...scratch]: number[],
    point: number
  ) {
    if (cofactor === 1n) return true;
    scale(scratch, zero, orderBits, point);
    return isZero(zero);
  }

  let { randomFields } = randomGenerators(p);

  /**
   * sample random curve points
   */
  function randomPoints(points: number[]) {
    let n = points.length;
    let xs = randomFields(n);

    using _ = Field.local.atCurrentOffset;
    let scratch = Field.local.getPointers(20);
    let [x2, inv, ...tmp] = scratch;

    for (let i = 0; i < n; i++) {
      let x = points[i];
      let y = x + sizeField;

      // copy x into memory / montgomery form
      Field.fromBigint(x, xs[i]);

      while (true) {
        // solve -x^2 + y^2 = 1 + d x^2 y^2 for y
        // => y^2 = (1 + x^2) / (1 - d x^2)
        Field.square(x2, x);
        Field.multiply(y, dPtr, x2);
        Field.subtract(y, Field.constants.mg1, y);
        Field.inverse(tmp[0], inv, y);
        Field.add(x2, x2, Field.constants.mg1);
        Field.multiply(y, x2, inv);
        let isSquare = Field.sqrt(tmp, y, y);

        // if we didn't find a square root, try again with x+1
        if (isSquare) break;
        Field.add(x, x, Field.constants.mg1);
      }

      // we found a square root!
      // also compute z and t
      let z = y + sizeField;
      let t = z + sizeField;
      Field.copy(z, Field.constants.mg1);
      Field.multiply(t, x, y);

      toSubgroupInPlace(scratch, x);
    }

    batchNormalize(points, points);
    return points;
  }

  function batchNormalize(affinePoints: number[], points: number[]): void {
    let n = affinePoints.length;
    assert(n === points.length, "lengths must match");
    using _ = Field.local.atCurrentOffset;
    let zInvs = Field.local.getZeroPointers(n);
    let zs = Field.local.getPointers(n);
    let scratch = Field.local.getPointer(5 * sizeField);

    // copy x, y, t and collect z coordinates
    for (let i = 0; i < n; i++) {
      copyPoint(affinePoints[i], points[i]);
      Field.copy(zs[i], points[i] + 2 * sizeField);
    }

    // batch invert z coordinates
    Field.batchInverse(scratch, zInvs[0], zs[0], n);

    // multiply x, y, t by zInv
    for (let i = 0; i < n; i++) {
      let [x, y, z, t] = coords(affinePoints[i]);
      Field.multiply(x, x, zInvs[i]);
      Field.multiply(y, y, zInvs[i]);
      Field.copy(z, Field.constants.mg1);
      Field.multiply(t, t, zInvs[i]);
    }
  }

  // note: this fails on zero
  function isOnCurve([A, B]: number[], P: number) {
    let [X, Y, Z, T] = coords(P);

    // validity of Z
    Field.reduce(Z);
    if (Field.isZero(Z)) return false;

    // validity of T
    Field.multiply(A, X, Y);
    Field.multiply(B, Z, T);
    Field.reduce(A);
    Field.reduce(B);
    if (!Field.isEqual(A, B)) return false;

    // curve equation
    Field.square(A, X);
    Field.square(B, Y);
    Field.subtract(A, B, A); // -X^2 + Y^2
    Field.square(B, Z);
    Field.subtract(A, A, B); // -X^2 + Y^2 - Z^2
    Field.square(B, T);
    Field.multiply(B, B, dPtr);
    Field.subtract(A, A, B); // -X^2 + Y^2 - Z^2 - d*T^2
    Field.reduce(A);
    return !!Field.isZero(A);
  }

  function toBigint(point: number): BigintPoint {
    let [x, y, z, t] = coords(point);
    Field.fromMontgomery(x);
    Field.fromMontgomery(y);
    Field.fromMontgomery(z);
    Field.fromMontgomery(t);
    let pointBigint = {
      X: Field.readBigint(x),
      Y: Field.readBigint(y),
      Z: Field.readBigint(z),
      T: Field.readBigint(t),
    };
    Field.toMontgomery(x);
    Field.toMontgomery(y);
    Field.toMontgomery(z);
    Field.toMontgomery(t);
    return pointBigint;
  }

  /**
   * The input can either be an array of pointers or a single pointer to a contiguous array.
   * In the second case, you must provide the length as well.
   */
  function toBigints(points: number[] | { ptr: number; length: number }) {
    using _ = Field.local.atCurrentOffset;
    let tmp = Field.local.getPointer(size);

    let pointsPtrs: number[];
    let n = points.length;
    if (Array.isArray(points)) pointsPtrs = points;
    else {
      let { ptr: pi } = points;
      pointsPtrs = Array(n);
      for (let i = 0; i < n; i++, pi += size) pointsPtrs[i] = pi;
    }
    let pointsBigint: BigintPoint[] = Array(n);

    for (let i = 0; i < n; i++) {
      let point = pointsPtrs[i];
      let x = point;
      let y = x + sizeField;
      let z = y + sizeField;
      let t = z + sizeField;

      Field.copy(tmp, x);
      Field.fromMontgomery(tmp);
      let X = Field.readBigint(tmp);

      Field.copy(tmp, y);
      Field.fromMontgomery(tmp);
      let Y = Field.readBigint(tmp);

      Field.copy(tmp, z);
      Field.fromMontgomery(tmp);
      let Z = Field.readBigint(tmp);

      Field.copy(tmp, t);
      Field.fromMontgomery(tmp);
      let T = Field.readBigint(tmp);

      pointsBigint[i] = { X, Y, Z, T };
    }

    return pointsBigint;
  }

  function fromBigint(point: number, P: BigintPoint) {
    let { X, Y, Z, T } = P;
    let [xPtr, yPtr, zPtr, tPtr] = coords(point);
    Field.writeBigint(xPtr, X);
    Field.writeBigint(yPtr, Y);
    Field.writeBigint(zPtr, Z);
    Field.writeBigint(tPtr, T);
    Field.toMontgomery(xPtr);
    Field.toMontgomery(yPtr);
    Field.toMontgomery(zPtr);
    Field.toMontgomery(tPtr);
  }

  /**
   * Expects as first argument a pointer which can fit a contiguous array of
   * affine points of the input size.
   */
  function fromBigints(pointPtr: number, inputPoints: BigintPoint[]) {
    let n = inputPoints.length;

    let { sizeField, writeBigint, toMontgomery } = Field;

    for (let i = 0, pi = pointPtr; i < n; i++, pi += size) {
      let { X, Y, Z, T } = inputPoints[i];

      let x = pi;
      let y = x + sizeField;
      let z = y + sizeField;
      let t = z + sizeField;

      writeBigint(x, X);
      writeBigint(y, Y);
      writeBigint(z, Z);
      writeBigint(t, T);
      toMontgomery(x);
      toMontgomery(y);
      toMontgomery(z);
      toMontgomery(t);
    }
    return pointPtr;
  }

  /**
   * Allocate a fresh pointer for the input points and write them to it.
   * Thin wrapper around {@link writeAffineBigints}.
   */
  function fromAffineBigints(inputPoints: { x: bigint; y: bigint }[]): number {
    let ptr = Field.global.getPointer(inputPoints.length * size);
    writeAffineBigints(ptr, inputPoints);
    return ptr;
  }

  /**
   * Expects as first argument a pointer which can fit a contiguous array of
   * affine points of the input size.
   */
  function writeAffineBigints(
    pointPtr: number,
    inputPoints: { x: bigint; y: bigint }[]
  ) {
    let n = inputPoints.length;

    let { sizeField, writeBigint, toMontgomery } = Field;

    for (let i = 0, pi = pointPtr; i < n; i++, pi += size) {
      let inputPoint = inputPoints[i];
      let x = pi;
      let y = x + sizeField;
      let z = y + sizeField;
      let t = z + sizeField;

      writeBigint(x, inputPoint.x);
      writeBigint(y, inputPoint.y);

      toMontgomery(x);
      toMontgomery(y);
      Field.copy(z, Field.constants.mg1);
      Field.multiply(t, x, y);
    }
    return pointPtr;
  }

  function X(point: number) {
    return point;
  }
  function Y(point: number) {
    return point + sizeField;
  }
  function Z(point: number) {
    return point + 2 * sizeField;
  }
  function T(point: number) {
    return point + 3 * sizeField;
  }

  return {
    Bigint: CurveBigint,
    add,
    addAssign,
    addMixed,
    subMixed,
    double,
    doubleInPlace,
    negate,
    negateInPlace,
    size,
    scale,
    toSubgroupInPlace,
    isOnCurve,
    isInSubgroup,
    zero,
    isZero,
    setZero,
    copy: copyPoint,
    toBigint,
    toBigints,
    fromBigint,
    fromBigints,
    fromAffineBigints,
    writeAffineBigints,
    randomPoints,

    X,
    Y,
    Z,
    T,

    batchNormalize,
  };
}

// what we need in other methods that can use both twisted edwards
// and affine/projective weierstrass curves
createCurveTwistedEdwards satisfies (...args: any[]) => MinimalCurve;

type MinimalCurve = {
  size: number;
  randomPoints: (pointers: number[]) => void;
  batchNormalize: (
    affinePointers: number[],
    projectivePointers: number[]
  ) => void;
  setZero: (pointer: number) => void;
  doubleInPlace: (scratch: number[], pointer: number) => void;
  copy: (target: number, source: number) => void;
  addAssign: (scratch: number[], P1: number, P2: number) => void;
};
