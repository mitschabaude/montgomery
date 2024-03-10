import { assert, bigintToBits } from "../util.js";
import { createField } from "./field.js";

export { createCurveAffine, BigintPoint, CurveParams };

type BigintPoint = { x: bigint; y: bigint; isZero: boolean };

type CurveParams = {
  label: string;
  modulus: bigint;
  order: bigint;
  cofactor: bigint;
  a: bigint;
  b: bigint;
  generator: { x: bigint; y: bigint };
  endomorphism?: {
    beta: bigint;
    lambda: bigint;
  };
};

/**
 * Operations on a short Weierstrass curve, with a = 0
 *
 * y^2 = x^3 + b
 *
 * The representation uses affine coordinates and a flag for zero.
 */
function createCurveAffine(params: CurveParams) {
  let { modulus: p, order: q, cofactor, b, a, generator } = params;
  assert(a === 0n, "only curves with a = 0 are supported for now");

  const Fp = createField(p);
  const Fq = createField(q);

  const zero: BigintPoint = { x: 0n, y: 1n, isZero: true };
  const one: BigintPoint = { ...generator, isZero: false };

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

    if (Fp.isEqual(x1, x2)) {
      // G + G --> we double
      if (Fp.isEqual(y1, y2)) return double(P1);
      // G - G --> return zero
      if (Fp.isEqual(y1, -y2)) return zero;
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
    if (isZero) return zero;

    // m = 3*x^2 / 2y
    let d = Fp.inverse(2n * y);
    let m = Fp.mod(3n * Fp.multiply(x, x) * d);
    // x2 = m^2 - 2x
    let x2 = Fp.mod(m * m - 2n * x);
    // y2 = m*(x - x2) - y
    let y2 = Fp.mod(m * (x - x2) - y);

    return { x: x2, y: y2, isZero: false };
  }

  /**
   * Negation, -P
   */
  function negate({ x, y, isZero }: BigintPoint): BigintPoint {
    if (isZero) return zero;
    return { x, y: Fp.negate(y), isZero: false };
  }

  function isEqual(P1: BigintPoint, P2: BigintPoint) {
    return (
      (P1.isZero === P2.isZero &&
        Fp.isEqual(P1.x, P2.x) &&
        Fp.isEqual(P1.y, P2.y)) ||
      (P1.isZero && P2.isZero)
    );
  }

  function isZero({ isZero }: BigintPoint): boolean {
    return isZero;
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
   */
  function isOnCurve({ x, y, isZero }: BigintPoint): boolean {
    if (isZero) return true;
    return Fp.isEqual(y * y, Fp.multiply(x, x) * x + b);
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
      // solve y^2 = x^3 + b for y
      let y2 = Fp.mod(Fp.multiply(x, x) * x + b);
      y = Fp.sqrt(y2);
    }

    let P = { x, y, isZero: false };
    return toSubgroup(P);
  }

  return {
    Field: Fp,
    Scalar: Fq,
    ...params,

    zero,
    one,
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
  };
}
