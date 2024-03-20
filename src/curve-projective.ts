import { MsmField } from "./field-msm.js";
import { bigintToBits } from "./util.js";

export { createCurveProjective, CurveProjective };

type CurveProjective = ReturnType<typeof createCurveProjective>;

function createCurveProjective(Field: MsmField, cofactor = 1n) {
  // convert the cofactor to bits
  let cofactorBits = bigintToBits(cofactor);

  const { sizeField, constants, memoryBytes } = Field;

  let size = 3 * sizeField + 4;

  /**
   * projective point addition with assignment, P1 += P2
   */
  function addAssign(scratch: number[], P1: number, P2: number) {
    add(scratch, P1, P1, P2);
  }

  /**
   * projective point addition, P3 = P1 + P2.
   *
   * Allows P1 and P3 to be the same memory address, i.e. doing P1 += P2.
   */
  function add(scratch: number[], P3: number, P1: number, P2: number) {
    let { subtract, multiply, square, isEqual, reduce } = Field;
    if (isZero(P1)) {
      copy(P3, P2);
      return;
    }
    if (isZero(P2)) {
      if (P1 !== P3) copy(P3, P1);
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
    // http://www.hyperelliptic.org/EFD/g1p/auto-shortw-projective.html#addition-add-1998-cmo-2
    // Y1Z2 = Y1*Z2
    multiply(Y1Z2, Y1, Z2);
    // Y2Z1 = Y2*Z1
    multiply(Y2Z1, Y2, Z1);
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
        // TODO
        if (P1 !== P3)
          throw Error("P1 !== P3 not implemented for doubling yet");
        doubleInPlace(scratch, P1);
        return;
      } else {
        setZero(P3);
        return;
      }
    }
    // Z1Z2 = Z1*Z2
    multiply(Z1Z2, Z1, Z2);
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
   * projective point doubling with assignment, P *= 2
   *
   * @param scratch
   * @param P
   */
  function doubleInPlace(scratch: number[], P: number) {
    let { add, subtract, multiply, square } = Field;
    if (isZero(P)) return;
    let [X1, Y1, Z1] = coords(P);
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
    multiply(X1, h, s);
    add(X1, X1, X1);
    // Y3 = w*(4*B-h)-8*R^2 = (Bx4 - h)*w - (Rx2^2 + Rx2^2)
    subtract(Y1, Bx4, h);
    multiply(Y1, Y1, w);
    square(tmp, Rx2);
    add(tmp, tmp, tmp); // TODO efficient doubling
    subtract(Y1, Y1, tmp);
    // Z3 = 8*sss
    multiply(Z1, sss, constants.mg8); // TODO efficient doubling
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
    [tmp, _tmpy, _tmpz, _tmpInf, ...scratch]: number[],
    point: number
  ) {
    if (cofactor === 1n) return;
    copy(tmp, point);
    scale(scratch, point, tmp, cofactorBits);
  }

  function isZero(pointer: number) {
    return !memoryBytes[pointer + 3 * sizeField];
  }

  function copy(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + size);
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

  function setNonZero(pointer: number) {
    memoryBytes[pointer + 3 * sizeField] = 1;
  }
  function setZero(pointer: number) {
    memoryBytes[pointer + 3 * sizeField] = 0;
  }

  function toBigint(point: number): BigintPointProjective {
    if (isZero(point)) return BigintPointProjective.zero;
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
    cofactor,
    cofactorBits,
    add,
    addAssign,
    doubleInPlace,
    scale,
    toSubgroupInPlace,
    toBigint,
    size,
    isZero,
    isEqual,
    copy,
    fromAffine,
    toAffine,
    coords,
    setNonZero,
    setZero,
  };
}

type BigintPointProjective = { X: bigint; Y: bigint; Z: bigint };
const BigintPointProjective = {
  zero: { X: 0n, Y: 1n, Z: 0n },
};
