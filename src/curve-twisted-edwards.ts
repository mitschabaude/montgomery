import type * as W from "wasmati"; // for type names
import { MsmField } from "./field-msm.js";
import { assert, bigintToBits } from "./util.js";
import { randomGenerators } from "./bigint/field-random.js";
import {
  BigintPoint,
  createCurveTwistedEdwards as createBigint,
} from "./bigint/twisted-edwards.js";

export { createCurveTwistedEdwards, CurveTwistedEdwards };

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
function createCurveTwistedEdwards(
  Field: MsmField,
  d: bigint,
  cofactor: bigint
) {
  const CurveBigint = createBigint(Field.p, d, cofactor);

  // write d to memory
  let [dPtr] = Field.local.getStablePointers(1);
  Field.writeBigint(dPtr, d);
  Field.toMontgomery(dPtr);

  // convert the cofactor to bits
  let cofactorBits = bigintToBits(cofactor);

  const { sizeField, square, multiply, add, copy, memoryBytes, p } = Field;

  // memory layout: x | y | z | t | isNonZero
  let size = 4 * sizeField + 4;

  function coords(pointer: number) {
    return [
      pointer,
      pointer + sizeField,
      pointer + 2 * sizeField,
      pointer + 3 * sizeField,
    ];
  }
  function copyPoint(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + size);
  }
  function isZero(pointer: number) {
    return !memoryBytes[pointer + 4 * sizeField];
  }
  function setNonZero(pointer: number) {
    memoryBytes[pointer + 4 * sizeField] = 1;
  }
  function setZero(pointer: number) {
    memoryBytes[pointer + 4 * sizeField] = 0;
  }

  /**
   * projective point addition with assignment, P1 += P2
   *
   * @param scratch
   * @param P1
   * @param P2
   */
  function addAssign(scratch: number[], P1: number, P2: number) {
    if (isZero(P1)) {
      copy(P1, P2);
      return;
    }
    if (isZero(P2)) return;
    setNonZero(P1);
    let [X1, Y1, Z1, T1] = coords(P1);
    let [X2, Y2, Z2, T2] = coords(P2);
    assert(false, "TODO");
  }

  /**
   * projective point doubling with assignment, P *= 2
   *
   * @param scratch
   * @param P
   */
  function doubleInPlace(scratch: number[], P: number) {
    if (isZero(P)) return;
    let [X1, Y1, Z1, T1] = coords(P);
    assert(false, "TODO");
  }

  function scale(
    scratch: number[],
    result: number,
    point: number,
    scalar: boolean[]
  ) {
    setZero(result);
    let n = scalar.length;
    for (let i = n - 1; i >= 0; i--) {
      if (scalar[i]) addAssign(scratch, result, point);
      if (i === 0) break;
      doubleInPlace(scratch, result);
    }
  }

  function toSubgroupInPlace(
    [tmp, _tmpy, _tmpz, _tmpt, _tmpInf, ...scratch]: number[],
    point: number
  ) {
    if (cofactor === 1n) return;
    copy(tmp, point);
    scale(scratch, point, tmp, cofactorBits);
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

      // copy x into memory
      Field.writeBigint(x, x0);
      Field.toMontgomery(x);

      while (true) {
        // TODO
        assert(false, "TODO");
      }
      setNonZero(x);
    }

    if (cofactor !== 1n) {
      for (let i = 0; i < n; i++) {
        toSubgroupInPlace(scratch, points[i]);
      }
    }
    return points;
  }

  // note: this fails on zero
  function assertOnCurve([y2, y2_]: number[], p: number) {
    let [X, Y, Z, T] = coords(p);
    assert(false, "TODO");
  }

  function toBigint(point: number): BigintPoint {
    if (isZero(point)) return CurveBigint.zero;
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

  function writeBigint(point: number, P: BigintPoint) {
    if (CurveBigint.isZero(P)) {
      setZero(point);
      return;
    }
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
    setNonZero(point);
  }

  return {
    addAssign,
    doubleInPlace,
    size,
    scale,
    toSubgroupInPlace,
    assertOnCurve,
    isZero,
    setZero,
    setNonZero,
    copyPoint,
    toBigint,
    writeBigint,
    randomPoints,
  };
}
