import type * as W from "wasmati"; // for type names
import { MsmField } from "./field-msm.js";
import { TODO, bigintToBits } from "./util.js";
import { randomGenerators } from "./bigint/field-random.js";
import {
  BigintPoint,
  CurveParams,
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

  function isZero(P: number) {
    // P is zero <=> X = 0 and Y = Z
    let X = P;
    let Y = X + sizeField;
    let Z = Y + sizeField;

    Field.reduce(X);
    let xIs0 = Field.isZero(X);
    Field.reduce(Y);
    Field.reduce(Z);
    let yIsZ = Field.isEqual(Y, Z);
    return xIs0 && yIsZ;
  }

  /**
   * projective point addition, P3 = P1 + P2
   *
   * - strongly unified addition
   * - handles if P3 is the same pointer as P1 and/or P2
   * - uses 2 full MULs for k*T1*T2
   * - 9M
   *
   * TODO: dedicated mixed addition and doubling
   */
  function add(
    [tmp, A, B, C, D, E, F, G, H]: number[],
    P3: number,
    P1: number,
    P2: number
  ) {
    // get coordinates
    let X1 = P1;
    let Y1 = X1 + sizeField;
    let Z1 = Y1 + sizeField;
    let T1 = Z1 + sizeField;

    let X2 = P2;
    let Y2 = X2 + sizeField;
    let Z2 = Y2 + sizeField;
    let T2 = Z2 + sizeField;

    let X3 = P3;
    let Y3 = X3 + sizeField;
    let Z3 = Y3 + sizeField;
    let T3 = Z3 + sizeField;

    // http://hyperelliptic.org/EFD/g1p/auto-twisted-extended-1.html#addition-add-2008-hwcd-3
    // Assumptions: k=2*d.

    // A = (Y1-X1)*(Y2-X2)
    Field.subtractPositive(A, Y1, X1);
    Field.subtractPositive(tmp, Y2, X2);
    Field.multiply(A, A, tmp);

    // B = (Y1+X1)*(Y2+X2)
    Field.addNoReduce(B, Y1, X1);
    Field.addNoReduce(tmp, Y2, X2);
    Field.multiply(B, B, tmp);

    // C = T1*k*T2
    Field.multiply(C, T1, T2);
    Field.multiply(C, C, k);

    // D = Z1*2*Z2
    Field.multiply(D, Z1, Z2);
    Field.addNoReduce(D, D, D);

    // E = B-A
    Field.subtractPositive(E, B, A);
    // F = D-C
    Field.subtractPositive(F, D, C);
    // G = D+C
    Field.addNoReduce(G, D, C);
    // H = B+A
    Field.addNoReduce(H, B, A);

    // X3 = E*F
    Field.multiply(X3, E, F);
    // Y3 = G*H
    Field.multiply(Y3, G, H);
    // T3 = E*H
    Field.multiply(T3, E, H);
    // Z3 = F*G
    Field.multiply(Z3, F, G);
  }

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
   * addition with assignment, P += Q
   */
  function addAssign(scratch: number[], P: number, Q: number) {
    add(scratch, P, P, Q);
  }

  /**
   * double, P3 = 2*P1
   *
   * TODO: dedicated doubling, saves some operations compared to add
   */
  function double(scratch: number[], P3: number, P1: number) {
    add(scratch, P3, P1, P1);
  }

  /**
   * Double in place, P *= 2
   *
   * TODO: implement dedicated doubling, saves some operations compared to add
   * squares instead of multiplies etc
   */
  function doubleInPlace(scratch: number[], P: number) {
    add(scratch, P, P, P);
  }

  /**
   * Scalar multiplication
   */
  function scale(
    scratch: number[],
    result: number,
    scalar: boolean[],
    point: number
  ) {
    let n = scalar.length;

    if (scalar[n - 1]) copyPoint(result, point);
    else copyPoint(result, zero);

    for (let i = n - 2; i >= 0; i--) {
      doubleInPlace(scratch, result);
      if (scalar[i]) addAssign(scratch, result, point);
    }
  }

  function toSubgroupInPlace(
    [tmp, _tmpy, _tmpz, _tmpt, _tmpInf, ...scratch]: number[],
    point: number
  ) {
    if (cofactor === 1n) return;
    Field.copy(tmp, point);
    scale(scratch, point, cofactorBits, tmp);
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
        TODO();
      }
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
    TODO();
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

  return {
    Bigint: CurveBigint,
    add,
    addAssign,
    double,
    doubleInPlace,
    negate,
    negateInPlace,
    size,
    scale,
    toSubgroupInPlace,
    assertOnCurve,
    zero,
    isZero,
    copyPoint,
    toBigint,
    fromBigint,
    randomPoints,
  };
}

const Specs = {};
