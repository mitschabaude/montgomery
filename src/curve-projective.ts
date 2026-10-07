import { type MsmField } from "./field-msm.ts";
import { bigintToBits } from "./util.ts";
import { type CurveParams } from "./bigint/affine-weierstrass.ts";
import {
  type BigintPoint,
  createCurveProjective as createBigint,
} from "./bigint/projective-weierstrass.ts";

export { createCurveProjective, type CurveProjective };

type CurveProjective = ReturnType<typeof createCurveProjective>;

function createCurveProjective(Field: MsmField, params: CurveParams) {
  const CurveBigint = createBigint(params);
  let { cofactor, b } = params;
  const { sizeField, constants, memoryBytes, limbBytes } = Field;

  // 3 field elements + 1 limb for the isNonZero flag
  let size = 3 * sizeField + limbBytes;

  // write b to memory
  // write d to memory
  let [bPtr] = Field.local.getStablePointers(1);
  Field.fromBigint(bPtr, b);

  // write the zero point to memory
  let [zero] = Field.local.getStablePointers(1, size);
  fromBigint(zero, CurveBigint.zero);

  // convert the cofactor to bits
  let cofactorBits = bigintToBits(cofactor);
  let orderBits = bigintToBits(CurveBigint.order);

  function copyPoint(target: number, source: number) {
    Field.copyMemory(target, source, size);
  }

  function isZero(pointer: number) {
    return !memoryBytes[pointer + 3 * sizeField];
  }
  function setNonZero(pointer: number) {
    memoryBytes[pointer + 3 * sizeField] = 1;
  }
  function setZero(pointer: number) {
    memoryBytes[pointer + 3 * sizeField] = 0;
  }

  // The formulas run in wasm: see src/wasm/curve.ts. scratch must be
  // contiguous field elements, 11 for additions and 8 for doubling.

  /**
   * projective point addition, P3 = P1 + P2.
   *
   * Allows P1 and P3 to be the same memory address, i.e. doing P1 += P2.
   */
  function add(scratch: number[], P3: number, P1: number, P2: number) {
    Field.addProjective(scratch[0], P3, P1, P2);
  }

  function sub(scratch: number[], P3: number, P1: number, P2: number) {
    Field.subProjective(scratch[0], P3, P1, P2);
  }

  function addMixed(scratch: number[], P3: number, P1: number, P2: number) {
    Field.addMixedProjective(scratch[0], P3, P1, P2);
  }

  function subMixed(scratch: number[], P3: number, P1: number, P2: number) {
    Field.subMixedProjective(scratch[0], P3, P1, P2);
  }

  /**
   * projective point addition with assignment, P1 += P2
   */
  function addAssign(scratch: number[], P1: number, P2: number) {
    Field.addProjective(scratch[0], P1, P1, P2);
  }

  /**
   * projective point doubling with assignment, P *= 2
   */
  function doubleInPlace(scratch: number[], P: number) {
    Field.doubleProjective(scratch[0], P, P);
  }

  /**
   * projective point doubling, P3 = 2*P1.
   *
   * works with P1 and P3 being the same memory address.
   */
  function double(scratch: number[], P3: number, P1: number) {
    Field.doubleProjective(scratch[0], P3, P1);
  }

  function negateInPlace(P: number) {
    let y = P + sizeField;
    Field.subtract(y, constants.zero, y);
  }

  function negate(Q: number, P: number) {
    copyPoint(Q, P);
    negateInPlace(Q);
  }

  /**
   * Scalar multiplication
   */
  function scale(
    [P, _py, _pz, _pInf, ...scratch]: number[],
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

  /**
   * Check if a point is on the curve
   */
  function isOnCurve([lhs, rhs, x3]: number[], P: number) {
    let [X, Y, Z] = coords(P);

    // Y^2 Z = X^3 + b Z^3
    Field.square(lhs, Y);
    Field.multiply(lhs, lhs, Z);

    Field.square(x3, X);
    Field.multiply(x3, x3, X);
    Field.square(rhs, Z);
    Field.multiply(rhs, rhs, Z);
    Field.multiply(rhs, rhs, bPtr);
    Field.add(rhs, rhs, x3);

    Field.reduce(lhs);
    Field.reduce(rhs);
    return !!Field.isEqual(lhs, rhs);
  }

  function fromAffine(P: number, A: number) {
    // x,y = x,y
    Field.copyMemory(P, A, 2 * sizeField);
    // z = 1
    Field.copy(P + 2 * sizeField, constants.mg1);
    // isInfinity = isInfinity
    memoryBytes[P + 3 * sizeField] = memoryBytes[A + 2 * sizeField];
  }

  function toAffine(scratch: number[], affine: number, point: number) {
    if (isZero(point)) {
      memoryBytes[affine + 2 * sizeField] = 0;
      return;
    }
    let zinv = scratch[0];
    let [x, y, z] = coords(point);
    let xAffine = affine;
    let yAffine = affine + sizeField;
    // return x/z, y/z
    Field.inverse(scratch[1], zinv, z);
    Field.multiply(xAffine, x, zinv);
    Field.multiply(yAffine, y, zinv);
    memoryBytes[xAffine + 2 * sizeField] = 1;
  }

  function coords(pointer: number) {
    return [pointer, pointer + sizeField, pointer + 2 * sizeField];
  }

  function toBigint(point: number): BigintPoint {
    if (isZero(point)) return CurveBigint.zero;
    let [x, y, z] = coords(point);
    Field.fromMontgomery(x);
    Field.fromMontgomery(y);
    Field.fromMontgomery(z);
    let pointBigint = {
      X: Field.readBigint(x),
      Y: Field.readBigint(y),
      Z: Field.readBigint(z),
    };
    Field.toMontgomery(x);
    Field.toMontgomery(y);
    Field.toMontgomery(z);
    return pointBigint;
  }

  function fromBigint(point: number, P: BigintPoint) {
    let { X, Y, Z } = P;
    if (Z === 0n) setZero(point);
    else setNonZero(point);
    let [xPtr, yPtr, zPtr] = coords(point);
    Field.writeBigint(xPtr, X);
    Field.writeBigint(yPtr, Y);
    Field.writeBigint(zPtr, Z);
    Field.toMontgomery(xPtr);
    Field.toMontgomery(yPtr);
    Field.toMontgomery(zPtr);
  }

  function isEqual(scratch: number[], p: number, q: number) {
    if (isZero(p)) return isZero(q);
    if (isZero(q)) return false;
    let [x1, y1, z1] = coords(p);
    let [x2, y2, z2] = coords(q);
    let tmp = scratch[0];
    let tmp2 = scratch[1];
    // x1/z1 == x2/z2
    Field.multiply(tmp, x1, z2);
    Field.reduce(tmp);
    Field.multiply(tmp2, x2, z1);
    Field.reduce(tmp2);
    if (!Field.isEqual(tmp, tmp2)) return false;
    // y1/z1 == y2/z2
    Field.multiply(tmp, y1, z2);
    Field.reduce(tmp);
    Field.multiply(tmp2, y2, z1);
    Field.reduce(tmp2);
    return Field.isEqual(tmp, tmp2);
  }

  return {
    Bigint: CurveBigint,

    cofactor,
    cofactorBits,
    size,

    add,
    sub,
    addMixed,
    subMixed,
    addAssign,
    double,
    doubleInPlace,
    negate,
    negateInPlace,

    scale,
    toSubgroupInPlace,
    isInSubgroup,

    zero,
    isZero,
    setZero,
    setNonZero,

    isEqual,
    isOnCurve,
    copy: copyPoint,

    toBigint,
    fromBigint,

    fromAffine,
    toAffine,

    coords,

    X(point: number) {
      return point;
    },
    Y(point: number) {
      return point + sizeField;
    },
    Z(point: number) {
      return point + 2 * sizeField;
    },
  };
}
