import { MsmField } from "./field-msm.js";

export { createCurveProjective, CurveProjective };

type CurveProjective = ReturnType<typeof createCurveProjective>;

function createCurveProjective(Field: MsmField) {
  const {
    sizeField,
    square,
    multiply,
    add,
    subtract,
    isEqual,
    constants,
    memoryBytes,
  } = Field;

  let sizeProjective = 3 * sizeField + 4;

  /**
   * projective point addition with assignement, P1 += P2
   *
   * @param scratch
   * @param P1
   * @param P2
   */
  function addAssignProjective(scratch: number[], P1: number, P2: number) {
    if (isZeroProjective(P1)) {
      copyProjective(P1, P2);
      return;
    }
    if (isZeroProjective(P2)) return;
    setNonZeroProjective(P1);
    let [X1, Y1, Z1] = projectiveCoords(P1);
    let [X2, Y2, Z2] = projectiveCoords(P2);
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
    if (isEqual(X1Z2, X2Z1) && isEqual(Y1Z2, Y2Z1)) {
      doubleInPlaceProjective(scratch, P1);
      return;
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
    multiply(X1, v, A);
    // Y3 = u*(R-A)-vvv*Y1Z2
    subtract(R, R, A);
    multiply(Y1, u, R);
    multiply(Y1Z2, vvv, Y1Z2);
    subtract(Y1, Y1, Y1Z2);
    // Z3 = vvv*Z1Z2
    multiply(Z1, vvv, Z1Z2);
  }

  /**
   * projective point doubling with assignment, P *= 2
   *
   * @param scratch
   * @param P
   */
  function doubleInPlaceProjective(scratch: number[], P: number) {
    if (isZeroProjective(P)) return;
    let [X1, Y1, Z1] = projectiveCoords(P);
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

  function isZeroProjective(pointer: number) {
    return !memoryBytes[pointer + 3 * sizeField];
  }

  function copyProjective(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + sizeProjective);
  }
  function copyAffineToProjective(P: number, A: number) {
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

  function projectiveCoords(pointer: number) {
    return [pointer, pointer + sizeField, pointer + 2 * sizeField];
  }

  function setNonZeroProjective(pointer: number) {
    memoryBytes[pointer + 3 * sizeField] = 1;
  }

  return {
    addAssignProjective,
    doubleInPlaceProjective,
    sizeProjective,
    isZeroProjective,
    copyProjective,
    copyAffineToProjective,
    projectiveCoords,
    setNonZeroProjective,
  };
}
