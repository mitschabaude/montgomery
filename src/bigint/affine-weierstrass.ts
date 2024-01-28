import { assert, bigintToBits } from "../util.js";
import { createField } from "./field.js";

export { createCurveAffine, BigintPoint, CurveParams };

type BigintPoint = { x: bigint; y: bigint; isZero: boolean };

type CurveParams = {
  modulus: bigint;
  order: bigint;
  cofactor: bigint;
  b: bigint;
  generator: { x: bigint; y: bigint };
};

/**
 * Operations on a short Weierstrass curve, with a = 0
 *
 * y^2 = x^3 + b
 *
 * The representation uses affine coordinates and a flag for zero.
 */
function createCurveAffine(params: CurveParams) {
  let { modulus: p, order: q, cofactor, b, generator } = params;
  const Fp = createField(p);
  const Fq = createField(q);

  const zero = { x: 0n, y: 1n, isZero: true } satisfies BigintPoint;

  /**
   * Addition, P1 + P2
   *
   * Complete / handles all edge cases
   */
  function add(P1: BigintPoint, P2: BigintPoint): BigintPoint {
    if (P1.isZero) return P2;
    if (P2.isZero) return P1;

    let { x: x1, y: y1 } = P1;
    let { x: x2, y: y2 } = P2;

    if (x1 === x2) {
      // G + G --> we double
      if (y1 === y2) return double(P1);
      // G - G --> return zero
      if (y1 === Fp.inverse(y2)) return zero;
      assert(false, "unreachable");
    }

    // m = (y2 - y1)/(x2 - x1)
    let d = Fp.inverse(x2 - x1);
    let m = Fp.multiply(y2 - y1, d);
    // x3 = m^2 - x1 - x2
    let x3 = Fp.mod(m * m - x1 - x2);
    // y3 = m*(x1 - x3) - y1
    let y3 = Fp.mod(m * (x1 - x3) - y1);

    return { x: x3, y: y3, isZero: false };
  }

  /**
   * Doubling, 2*P
   */
  function double({ x, y, isZero }: BigintPoint): BigintPoint {
    if (isZero) zero;

    // m = 3*x^2 / 2y
    let d = Fp.inverse(2n * y);
    let m = Fp.mod(3n * x * x * d);
    // x2 = m^2 - 2x
    let x2 = Fp.mod(m * m - 2n * x);
    // y2 = m*(x - x2) - y
    let y2 = Fp.mod(m * (x - x2) - y);

    return { x: x2, y: y2, isZero: false };
  }

  /**
   * Negation, -P
   */
  function negate(P: BigintPoint): BigintPoint {
    return { X: Fp.negate(P.X), Y: P.Y, Z: P.Z, T: Fp.negate(P.T) };
  }

  function isEqual(P1: BigintPoint, P2: BigintPoint) {
    return (
      // protect against invalid points with z=0
      !Fp.isEqual(P1.Z, 0n) &&
      !Fp.isEqual(P2.Z, 0n) &&
      // multiply out with Z
      Fp.isEqual(P1.X * P2.Z, P2.X * P1.Z) &&
      Fp.isEqual(P1.Y * P2.Z, P2.Y * P1.Z) &&
      // redundant for valid points, but this function should work if one input is invalid
      Fp.isEqual(P1.T * P2.Z, P2.T * P1.Z)
    );
  }

  function isZero({ X, Y, Z, T }: BigintPoint): boolean {
    return (
      !Fp.isEqual(Z, 0n) &&
      Fp.isEqual(X, 0n) &&
      Fp.isEqual(T, 0n) &&
      Fp.isEqual(Y, Z)
    );
  }

  /**
   * Scalar multiplication, s*P
   */
  function scale(s: bigint, P: BigintPoint): BigintPoint {
    let Q = zero;
    let bits = bigintToBits(s);
    for (let i = bits.length - 1; i >= 0; i--) {
      Q = double(Q);
      if (bits[i]) Q = add(Q, P);
    }
    return Q;
  }

  /**
   * Project a point to the correct subgroup
   */
  function toSubgroup(P: BigintPoint): BigintPoint {
    if (cofactor === 1n) return P;
    return scale(cofactor, P);
  }

  /**
   * Check if a point is on the curve
   *
   * In projective coordinates, the curve equation is
   *
   * -X^2 Z^2 + Y^2 Z^2 = Z^4 + d X^2 Y^2
   *
   * or, after dividing by Z^2 and using T = XY/Z,
   *
   * -X^2 + Y^2 = Z^2 + d T^2
   */
  function isOnCurve(P: BigintPoint): boolean {
    let { X, Y, T, Z } = P;
    // validity of Z
    if (Fp.isEqual(Z, 0n)) return false;
    // validity of T
    if (!Fp.isEqual(T * Z, X * Y)) return false;
    // curve equation
    return Fp.isEqual(-X * X + Y * Y, Z * Z + d * Fp.square(T));
  }

  function isInSubgroup(P: BigintPoint): boolean {
    return isZero(scale(q, P));
  }

  function random(): BigintPoint {
    // random x
    let x = Fp.random();
    let y: bigint | undefined;

    while (y === undefined) {
      x = Fp.add(x, 1n);
      // solve -x^2 + y^2 = 1 + d x^2 y^2 for y
      // => y^2 = (1 + x^2) / (1 - d x^2)
      let y2 = Fp.multiply(
        1n + Fp.multiply(x, x),
        Fp.inverse(1n - Fp.multiply(d, Fp.multiply(x, x)))
      );
      y = Fp.sqrt(y2);
    }

    let P = { X: x, Y: y, Z: 1n, T: Fp.multiply(x, y) };
    return toSubgroup(P);
  }

  return {
    Field: Fp,
    Scalar: Fq,
    ...params,

    zero,
    one: fromAffine(generator),
    add,
    double,
    negate,
    scale,
    toSubgroup,
    isOnCurve,
    isInSubgroup,
    isEqual,
    isZero,
    random,
    fromAffine,
    toAffine,
  };
}
