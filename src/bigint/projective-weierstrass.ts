import { assert, bigintToBits } from "../util.js";
import type { CurveParams } from "./affine-weierstrass.js";
import { createField } from "./field.js";

export { createCurveProjective, BigintPoint };

type BigintPoint = { X: bigint; Y: bigint; Z: bigint };

/**
 * Operations on a short Weierstrass curve, with a = 0,
 * using projective coordinates.
 *
 * Y^2 Z = X^3 + b Z^3
 */
function createCurveProjective(params: CurveParams) {
  let { modulus: p, order: q, cofactor, b, a, generator } = params;
  assert(a === 0n, "only curves with a = 0 are supported for now");

  const Fp = createField(p);
  const Fq = createField(q);

  const zero: BigintPoint = { X: 0n, Y: 1n, Z: 0n };
  const one: BigintPoint = { X: generator.x, Y: generator.y, Z: 1n };

  /**
   * Addition, P1 + P2
   *
   * Complete / handles all edge cases
   */
  function add(P1: BigintPoint, P2: BigintPoint): BigintPoint {
    // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#addition-add-1998-cmo-2
    // plus doubling and zero cases
    let { X: X1, Y: Y1, Z: Z1 } = P1;
    let { X: X2, Y: Y2, Z: Z2 } = P2;

    // handle zero
    if (Fp.isEqual(Z1, 0n)) return P2;
    if (Fp.isEqual(Z2, 0n)) return P1;

    // Y1Z2 = Y1*Z2
    let Y1Z2 = Fp.multiply(Y1, Z2);
    // X1Z2 = X1*Z2
    let X1Z2 = Fp.multiply(X1, Z2);
    // Z1Z2 = Z1*Z2
    let Z1Z2 = Fp.multiply(Z1, Z2);
    // u = Y2*Z1-Y1Z2
    let u = Fp.mod(Y2 * Z1 - Y1Z2);
    // uu = u2
    let uu = Fp.square(u);
    // v = X2*Z1-X1Z2
    let v = Fp.mod(X2 * Z1 - X1Z2);

    // handle edge cases
    // x1 == x2 <=> X2*Z1-X1*Z2 <==> v == 0
    if (Fp.isEqual(v, 0n)) {
      // y1 == y2 <=> Y2*Z1-Y1*Z2 <==> u == 0
      if (Fp.isEqual(u, 0n)) return double(P1);
      return zero;
    }

    // vv = v2
    let vv = Fp.square(v);
    // vvv = v*vv
    let vvv = Fp.multiply(v, vv);
    // R = vv*X1Z2
    let R = Fp.multiply(vv, X1Z2);
    // A = uu*Z1Z2-vvv-2*R
    let A = Fp.mod(uu * Z1Z2 - vvv - 2n * R);
    // X3 = v*A
    let X3 = Fp.multiply(v, A);
    // Y3 = u*(R-A)-vvv*Y1Z2
    let Y3 = Fp.mod(u * (R - A) - vvv * Y1Z2);
    // Z3 = vvv*Z1Z2
    let Z3 = Fp.multiply(vvv, Z1Z2);

    return { X: X3, Y: Y3, Z: Z3 };
  }

  /**
   * Doubling, 2*P
   */
  function double(P: BigintPoint): BigintPoint {
    // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#doubling-dbl-1998-cmo-2
    // plus zero case
    let { X: X1, Y: Y1, Z: Z1 } = P;

    // handle zero
    if (Fp.isEqual(Z1, 0n)) return zero;

    // w = a*Z1^2 + 3*X1^2, assuming a = 0
    let w = Fp.mod(3n * X1 * X1);
    // s = Y1*Z1
    let s = Fp.multiply(Y1, Z1);
    // ss = s2
    let ss = Fp.square(s);
    // sss = s*ss
    let sss = s * ss;
    // R = Y1*s
    let R = Fp.multiply(Y1, s);
    // B = X1*R
    let B = Fp.multiply(X1, R);
    // h = w^2-8*B
    let h = Fp.mod(w * w - 8n * B);
    // X3 = 2*h*s
    let X3 = Fp.multiply(2n * h, s);
    // Y3 = w*(4*B-h)-8*R^2
    let Y3 = Fp.mod(w * (4n * B - h) - 8n * R * R);
    // Z3 = 8*sss = 8*s*ss
    let Z3 = Fp.mod(8n * sss);

    return { X: X3, Y: Y3, Z: Z3 };
  }

  /**
   * Negation, -P
   */
  function negate({ X, Y, Z }: BigintPoint): BigintPoint {
    return { X, Y: Fp.negate(Y), Z };
  }

  function isEqual(
    { X: X1, Y: Y1, Z: Z1 }: BigintPoint,
    { X: X2, Y: Y2, Z: Z2 }: BigintPoint
  ) {
    // handle zero
    if (Fp.isEqual(Z1, 0n)) return Fp.isEqual(Z2, 0n);
    if (Fp.isEqual(Z2, 0n)) return false;

    // x1/z1 == x2/z2 and y1/z1 == y2/z2
    return (
      Fp.isEqual(Fp.multiply(X1, Z2), Fp.multiply(X2, Z1)) &&
      Fp.isEqual(Fp.multiply(Y1, Z2), Fp.multiply(Y2, Z1))
    );
  }

  function isZero({ Z }: BigintPoint): boolean {
    return Fp.isEqual(Z, 0n);
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
  function isOnCurve({ X, Y, Z }: BigintPoint): boolean {
    // Y^2 Z = X^3 + b Z^3
    return Fp.isEqual(
      Fp.multiply(Fp.multiply(Y, Y), Z),
      Fp.multiply(Fp.multiply(X, X), X) + b * Fp.multiply(Fp.multiply(Z, Z), Z)
    );
  }

  function isInSubgroup(P: BigintPoint): boolean {
    return isZero(scale(q, P));
  }

  function random(): BigintPoint {
    // random x
    let X = Fp.random();
    let Y: bigint | undefined;

    while (Y === undefined) {
      X = Fp.add(X, 1n);
      // solve y^2 = x^3 + b for y
      let y2 = Fp.mod(Fp.multiply(X, X) * X + b);
      Y = Fp.sqrt(y2);
    }

    let P = { X, Y, Z: 1n };
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
