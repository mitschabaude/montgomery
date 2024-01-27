import { MsmField } from "./field-msm.js";
import { bigintToBits } from "./util.js";
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
    memoryBytes.copyWithin(target, source, source + size);
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

    return points;
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
    isOnCurve,
    isInSubgroup,
    zero,
    isZero,
    setZero,
    copy: copyPoint,
    toBigint,
    fromBigint,
    randomPoints,
    // for compatibility with affine / projective
    fromAffine(point: number, affinePoint: number) {
      copyPoint(point, affinePoint);
    },
    // TODO actually normalize here
    batchNormalize(
      affinePointers: number[],
      projectivePointers: number[]
    ): void {
      let n = affinePointers.length;
      for (let i = 0; i < n; i++) {
        let affine = affinePointers[i];
        let projective = projectivePointers[i];
        copyPoint(affine, projective);
      }
    },
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
  fromAffine: (pointer: number, affinePointer: number) => void;
  doubleInPlace: (scratch: number[], pointer: number) => void;
  copy: (target: number, source: number) => void;
  addAssign: (scratch: number[], P1: number, P2: number) => void;
};
