import { MsmField } from "./field-msm.js";
import { bigintToBits } from "./util.js";
import { CurveParams } from "./bigint/affine-weierstrass.js";
import {
  BigintPoint,
  createCurveProjective as createBigint,
} from "./bigint/projective-weierstrass.js";

export { createCurveProjective, CurveProjective };

type CurveProjective = ReturnType<typeof createCurveProjective>;

function createCurveProjective(Field: MsmField, params: CurveParams) {
  const CurveBigint = createBigint(params);
  let { cofactor, b } = params;
  const { sizeField, constants, memoryBytes } = Field;

  let size = 3 * sizeField + 4;

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
    memoryBytes.copyWithin(target, source, source + size);
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

  /**
   * Base method for projective point addition which supports mixed addition and subtraction.
   * Allows P1 and P3 to be the same memory address.
   */
  function addOrSubtract(
    scratch: number[],
    P3: number,
    P1: number,
    P2: number,
    // whether P2 should be negated
    isSubtract: boolean,
    // whether we can assume Z2 = 1
    isMixed: boolean
  ) {
    let { subtract, multiply, square, isEqual, reduce } = Field;
    if (isZero(P1)) {
      copyPoint(P3, P2);
      if (isSubtract) negateInPlace(P3);
      return;
    }
    if (isZero(P2)) {
      if (P1 !== P3) copyPoint(P3, P1);
      return;
    }
    setNonZero(P3);

    // coordinates
    let X1 = P1;
    let Y1 = X1 + sizeField;
    let Z1 = Y1 + sizeField;
    let X2 = P2;
    let Y2 = X2 + sizeField;
    let Z2 = Y2 + sizeField;
    let X3 = P3;
    let Y3 = X3 + sizeField;
    let Z3 = Y3 + sizeField;

    let [Y2Z1, Y1Z2, X2Z1, X1Z2, Z1Z2, u, uu, v, vv, vvv, R] = scratch;
    let y2: number;
    if (isSubtract) {
      y2 = u;
      Field.subtract(y2, constants.zero, Y2);
    } else {
      y2 = Y2;
    }

    // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#addition-add-1998-cmo-2
    // Y1Z2 = Y1*Z2
    if (isMixed) {
      copyPoint(Y1Z2, Y1);
    } else {
      multiply(Y1Z2, Y1, Z2);
    }
    // Y2Z1 = Y2*Z1
    multiply(Y2Z1, y2, Z1);
    // X1Z2 = X1*Z2
    multiply(X1Z2, X1, Z2);
    // X2Z1 = X2*Z1
    multiply(X2Z1, X2, Z1);

    // double if the points are equal
    // x1*z2 = x2*z1 and y1*z2 = y2*z1
    // <==>  x1/z1 = x2/z2 and y1/z1 = y2/z2
    reduce(X1Z2);
    reduce(X2Z1);
    if (isEqual(X1Z2, X2Z1)) {
      reduce(Y1Z2);
      reduce(Y2Z1);
      if (isEqual(Y1Z2, Y2Z1)) {
        double(scratch, P3, P1);
        return;
      } else {
        setZero(P3);
        return;
      }
    }
    // Z1Z2 = Z1*Z2
    if (isMixed) {
      copyPoint(Z1Z2, Z1);
    } else {
      multiply(Z1Z2, Z1, Z2);
    }
    // u = Y2Z1-Y1Z2
    subtract(u, Y2Z1, Y1Z2);
    // uu = u^2
    square(uu, u);
    // v = X2Z1-X1Z2
    subtract(v, X2Z1, X1Z2);
    // vv = v^2
    square(vv, v);
    // vvv = v*vv
    multiply(vvv, v, vv);
    // R = vv*X1Z2
    multiply(R, vv, X1Z2);
    // A = uu*Z1Z2-vvv-2*R
    let A = uu;
    multiply(A, uu, Z1Z2);
    subtract(A, A, vvv);
    subtract(A, A, R);
    subtract(A, A, R);
    // X3 = v*A
    multiply(X3, v, A);
    // Y3 = u*(R-A)-vvv*Y1Z2
    subtract(R, R, A);
    multiply(Y3, u, R);
    multiply(Y1Z2, vvv, Y1Z2);
    subtract(Y3, Y3, Y1Z2);
    // Z3 = vvv*Z1Z2
    multiply(Z3, vvv, Z1Z2);
  }

  /**
   * projective point addition, P3 = P1 + P2.
   *
   * Allows P1 and P3 to be the same memory address, i.e. doing P1 += P2.
   */
  function add(scratch: number[], P3: number, P1: number, P2: number) {
    addOrSubtract(scratch, P3, P1, P2, false, false);
  }

  function sub(scratch: number[], P3: number, P1: number, P2: number) {
    addOrSubtract(scratch, P3, P1, P2, true, false);
  }

  function addMixed(scratch: number[], P3: number, P1: number, P2: number) {
    addOrSubtract(scratch, P3, P1, P2, false, true);
  }

  function subMixed(scratch: number[], P3: number, P1: number, P2: number) {
    addOrSubtract(scratch, P3, P1, P2, true, true);
  }

  /**
   * projective point addition with assignment, P1 += P2
   */
  function addAssign(scratch: number[], P1: number, P2: number) {
    addOrSubtract(scratch, P1, P1, P2, false, false);
  }

  /**
   * projective point doubling with assignment, P *= 2
   */
  function doubleInPlace(scratch: number[], P: number) {
    double(scratch, P, P);
  }

  /**
   * projective point doubling, P3 = 2*P1.
   *
   * works with P1 and P3 being the same memory address.
   */
  function double(scratch: number[], P3: number, P1: number) {
    let { add, subtract, multiply, square } = Field;
    if (isZero(P1)) {
      setZero(P3);
      return;
    }

    // coordinates
    let X1 = P1;
    let Y1 = X1 + sizeField;
    let Z1 = Y1 + sizeField;
    let X3 = P3;
    let Y3 = X3 + sizeField;
    let Z3 = Y3 + sizeField;

    let [tmp, w, s, ss, sss, Rx2, Bx4, h] = scratch;
    // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#doubling-dbl-1998-cmo-2
    // w = 3*X1^2
    square(w, X1);
    add(tmp, w, w); // TODO efficient doubling
    add(w, tmp, w);
    // s = Y1*Z1
    multiply(s, Y1, Z1);
    // ss = s^2
    square(ss, s);
    // sss = s*ss
    multiply(sss, ss, s);
    // R = Y1*s, Rx2 = R + R
    multiply(Rx2, Y1, s);
    add(Rx2, Rx2, Rx2);
    // 2*B (= X1*R), Bx4 = 2*B+2*B
    multiply(Bx4, X1, Rx2);
    add(Bx4, Bx4, Bx4);
    // h = w^2-8*B = w^2 - Bx4 - Bx4
    square(h, w);
    subtract(h, h, Bx4); // TODO efficient doubling
    subtract(h, h, Bx4);
    // X3 = 2*h*s
    multiply(X3, h, s);
    add(X3, X3, X3);
    // Y3 = w*(4*B-h)-8*R^2 = (Bx4 - h)*w - (Rx2^2 + Rx2^2)
    subtract(Y3, Bx4, h);
    multiply(Y3, Y3, w);
    square(tmp, Rx2);
    add(tmp, tmp, tmp); // TODO efficient doubling
    subtract(Y3, Y3, tmp);
    // Z3 = 8*sss
    multiply(Z3, sss, constants.mg8); // TODO efficient doubling
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
    memoryBytes.copyWithin(P, A, A + 2 * sizeField);
    // z = 1
    memoryBytes.copyWithin(
      P + 2 * sizeField,
      constants.mg1,
      constants.mg1 + sizeField
    );
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
    isEqual,
    isOnCurve,
    copy: copyPoint,

    toBigint,
    fromBigint,

    fromAffine,
    toAffine,

    coords,
    setNonZero,
    setZero,
  };
}
