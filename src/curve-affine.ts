import type * as W from "wasmati"; // for type names
import { MsmField } from "./field-msm.js";
import { randomGenerators } from "./bigint/field-random.js";
import type { CurveProjective } from "./curve-projective.js";
import { assert } from "./util.js";

export {
  createCurveAffine,
  batchAddNew,
  batchAddUnsafeNew,
  batchAdd,
  batchAddUnsafe,
  batchDoubleInPlace,
  CurveAffine,
};

export { getSizeAffine };

/**
 * Memory layout of curve points
 * -------------
 *
 * a _field element_ x is represented as n limbs, where n is a parameter that depends on the field order and limb size.
 * in wasm memory, each limb is stored as an `i32`, i.e. takes up 4 bytes of space.
 * (usually only the lowest w bits of each `i32` are filled, where w <= 32 is some configured limb size)
 *
 * an _affine point_ is layed out as `[x, y, isNonZero]` in memory, where x and y are field elements and
 * `isNonZero` is a flag used to track whether a point is zero / the point at infinity.
 * - x, y each have length sizeField = 4*n bytes
 * - `isNonZero` is either 0 or 1, but we nevertheless reserve 4 bytes (one `i32`) of space for it.
 *   this helps ensure that all memory addresses are multiples of 4, a property which is required by JS APIs like
 *   Uint32Array, and which should also make memory accesses more efficient.
 *
 * in code, we represent an affine point by a pointer `p`.
 * a pointer is just a JS `number`, and can be easily passed between wasm and JS.
 * on the wasm side, a number appears as an `i32`, suitable as input to memory load/store operations.
 *
 * from `p`, we obtain pointers to the individual coordinates as
 * ```
 * x = p
 * y = p + sizeField
 * isNonZero = p + 2*sizeField
 * ```
 *
 * for a _projective point_, the layout is `[x, y, z, isNonZero]`.
 * we can obtain x, y from a pointer as before, and
 * ```
 * z = p + 2*sizeField
 * isNonZero = p + 3*sizeField
 * ```
 */

type CurveAffine = ReturnType<typeof createCurveAffine>;

/**
 * create arithmetic for elliptic curve
 *
 * y^2 = x^3 + b
 *
 * over the `Field`
 */
function createCurveAffine(
  Field: MsmField,
  CurveProjective: CurveProjective,
  b: bigint
) {
  // write b to memory
  let [bPtr] = Field.local.getStablePointers(1);
  Field.writeBigint(bPtr, b);
  Field.toMontgomery(bPtr);

  const { sizeField, square, multiply, add, subtract, copy, memoryBytes, p } =
    Field;

  // an affine point is 2 field elements + 1 int32 for isNonZero flag
  let size = 2 * sizeField + 4;

  /**
   * affine EC doubling, H = 2*G
   *
   * assuming d = 1/(2*y) is given, and inputs aren't zero.
   *
   * this supports doubling a point in-place with H === G
   * @param scratch
   * @param H output point
   * @param G input point (x, y)
   * @param d 1/(2y)
   */
  function double([m, tmp, x2, y2]: number[], H: number, G: number, d: number) {
    let [x, y] = coords(G);
    let [xOut, yOut] = coords(H);
    // m = 3*x^2*d
    square(m, x);
    add(tmp, m, m); // TODO efficient doubling
    add(m, tmp, m);
    multiply(m, d, m);
    // x2 = m^2 - 2x
    square(x2, m);
    add(tmp, x, x); // TODO efficient doubling
    subtract(x2, x2, tmp);
    // y2 = (x - x2)*m - y
    subtract(y2, x, x2);
    multiply(y2, y2, m);
    subtract(y2, y2, y);
    // H = x2,y2
    copy(xOut, x2);
    copy(yOut, y2);
  }

  function scale(
    [
      resultProj,
      _ry,
      _rz,
      _rinf,
      pointProj,
      _py,
      _pz,
      _pinf,
      ...scratch
    ]: number[],
    result: number,
    point: number,
    scalar: boolean[]
  ) {
    CurveProjective.fromAffine(pointProj, point);
    CurveProjective.scale(scratch, resultProj, pointProj, scalar);
    CurveProjective.toAffine(scratch, result, resultProj);
  }

  function toSubgroupInPlace(
    [tmp, _tmpy, _tmpz, _tmpInf, ...scratch]: number[],
    point: number
  ) {
    if (CurveProjective.cofactor === 1n) return;
    copyAffine(tmp, point);
    scale(scratch, point, tmp, CurveProjective.cofactorBits);
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
  function randomPoints(points: number[]) {
    let n = points.length;
    let xs = randomFields(n);
    using _ = Field.local.atCurrentOffset;
    let scratch = Field.local.getPointers(30);

    for (let i = 0; i < n; i++) {
      let x0 = xs[i];
      let x = points[i];
      let y = x + sizeField;

      // copy x into memory
      Field.writeBigint(x, x0);
      Field.toMontgomery(x);

      while (true) {
        // compute sqrt(x^3 + b), store in y
        square(y, x);
        multiply(y, y, x);
        add(y, y, bPtr);
        let isSquare = Field.sqrt(scratch, y, y);

        // if we didn't find a square root, try again with x+1
        if (isSquare) break;
        add(x, x, Field.constants.mg1);
      }
      setIsNonZero(x, true);
    }

    if (CurveProjective.cofactor !== 1n) {
      for (let i = 0; i < n; i++) {
        toSubgroupInPlace(scratch, points[i]);
      }
    }
    return points;
  }

  // note: this fails on zero
  function assertOnCurve([y2, y2_]: number[], p: number) {
    let [x, y] = coords(p);
    square(y2, x);
    multiply(y2, y2, x);
    add(y2, y2, bPtr);
    Field.reduce(y2);
    Field.square(y2_, y);
    Field.reduce(y2_);
    assert(Field.isEqual(y2_, y2) === 1, "point on curve");
  }

  function isZero(pointer: number) {
    return !memoryBytes[pointer + 2 * sizeField];
  }

  function copyAffine(target: number, source: number) {
    memoryBytes.copyWithin(target, source, source + size);
  }

  function coords(pointer: number) {
    return [pointer, pointer + sizeField];
  }

  function setIsNonZero(pointer: number, isNonZero: boolean) {
    memoryBytes[pointer + 2 * sizeField] = Number(isNonZero);
  }

  function toBigint(point: number): BigintPoint {
    if (isZero(point)) return BigintPoint.zero;
    let [x, y] = coords(point);
    Field.fromMontgomery(x);
    Field.fromMontgomery(y);
    let pointBigint = {
      x: Field.readBigint(x),
      y: Field.readBigint(y),
      isZero: false,
    };
    Field.toMontgomery(x);
    Field.toMontgomery(y);
    return pointBigint;
  }

  function writeBigint(point: number, { x, y, isZero }: BigintPoint) {
    if (isZero) {
      setIsNonZero(point, false);
      return;
    }
    let [xPtr, yPtr] = coords(point);
    Field.writeBigint(xPtr, x);
    Field.writeBigint(yPtr, y);
    Field.toMontgomery(xPtr);
    Field.toMontgomery(yPtr);
    setIsNonZero(point, true);
  }

  function batchFromProjective(points: number[], pointsProj: number[]) {
    let n = points.length;
    assert(n === pointsProj.length, "lengths must match");
    // copy x, y coordinates and collect z coordinates
    using _ = Field.local.atCurrentOffset;
    let zInvs = Field.local.getZeroPointers(n, sizeField);
    let zs = Field.local.getPointers(n, sizeField);
    let scratch = Field.local.getPointer(5 * sizeField);
    for (let i = 0; i < n; i++) {
      if (CurveProjective.isZero(pointsProj[i])) {
        setIsNonZero(points[i], false);
        Field.copy(zs[i], Field.constants.mg1);
        continue;
      }
      let xAffine = points[i];
      let yAffine = points[i] + sizeField;
      setIsNonZero(xAffine, true);
      let [x, y, z] = CurveProjective.coords(pointsProj[i]);
      Field.copy(xAffine, x);
      Field.copy(yAffine, y);
      Field.copy(zs[i], z);
    }
    // batch invert z coordinates
    Field.batchInverse(scratch, zInvs[0], zs[0], n);
    // x, y <- x/z, y/z
    for (let i = 0; i < n; i++) {
      if (isZero(points[i])) continue;
      let x = points[i];
      let y = points[i] + sizeField;
      Field.multiply(x, x, zInvs[i]);
      Field.multiply(y, y, zInvs[i]);
    }
  }

  return {
    b,
    size,
    double,
    scale,
    toSubgroupInPlace,
    assertOnCurve,
    isZero,
    copy: copyAffine,
    coords,
    setIsNonZero,
    toBigint,
    writeBigint,
    batchNormalize: batchFromProjective,
    randomPoints,
    randomPointsBigint(n: number, { montgomery = false } = {}) {
      let memoryOffset = Field.getOffset();
      let points = Field.getZeroPointers(n, size);
      randomPoints(points);
      let pointsBigint: BigintPoint[] = Array(n);
      for (let i = 0; i < n; i++) {
        let point = points[i];
        let x = point;
        let y = point + sizeField;
        if (!montgomery) {
          Field.fromMontgomery(x);
          Field.fromMontgomery(y);
        } else {
          Field.reduce(x);
          Field.reduce(y);
        }
        pointsBigint[i] = {
          x: Field.readBigint(x),
          y: Field.readBigint(y),
          isZero: false,
        };
      }
      Field.setOffset(memoryOffset);
      return pointsBigint;
    },
  };
}

function getSizeAffine(sizeField: number) {
  return 2 * sizeField + 4;
}

type BigintPoint = { x: bigint; y: bigint; isZero: boolean };
const BigintPoint = {
  zero: { x: 0n, y: 0n, isZero: true },
};

/**
 * Like {@link batchAdd}, but uses less memory.
 */
function batchAddNew(
  Field: MsmField,
  Curve: CurveAffine,
  scratch: number[],
  S: Uint32Array,
  G: Uint32Array,
  H: Uint32Array,
  n: number
) {
  let { sizeField, subtractPositive, batchInverse, addAffine, isEqual, add } =
    Field;
  let {
    double: doubleAffine,
    isZero: isZeroAffine,
    copy: copyAffine,
    setIsNonZero: setIsNonZeroAffine,
  } = Curve;

  using _ = Field.local.atCurrentOffset;
  let d = Uint32Array.from(Field.local.getPointers(n, sizeField));
  let tmp = Uint32Array.from(Field.local.getPointers(n, sizeField));

  let iAdd = Array(n);
  let iDouble = Array(n);
  let iBoth = Array(n);
  let nAdd = 0;
  let nDouble = 0;
  let nBoth = 0;

  for (let i = 0; i < n; i++) {
    // check G, H for zero
    if (isZeroAffine(G[i])) {
      copyAffine(S[i], H[i]);
      continue;
    }
    if (isZeroAffine(H[i])) {
      if (S[i] !== G[i]) copyAffine(S[i], G[i]);
      continue;
    }
    if (isEqual(G[i], H[i])) {
      // here, we handle the x1 === x2 case, in which case (x2 - x1) shouldn't be part of batch inversion
      // => batch-affine doubling G[p] in-place for the y1 === y2 cases, setting G[p] zero for y1 === -y2
      let y = G[i] + sizeField;
      if (!isEqual(y, H[i] + sizeField)) {
        setIsNonZeroAffine(S[i], false);
        continue;
      }
      add(tmp[nBoth], y, y); // TODO: efficient doubling
      iDouble[nDouble] = i;
      iBoth[i] = nBoth;
      nDouble++, nBoth++;
    } else {
      // typical case, where x1 !== x2 and we add the points
      subtractPositive(tmp[nBoth], H[i], G[i]);
      iAdd[nAdd] = i;
      iBoth[i] = nBoth;
      nAdd++, nBoth++;
    }
  }
  batchInverse(scratch[0], d[0], tmp[0], nBoth);
  for (let j = 0; j < nAdd; j++) {
    let i = iAdd[j];
    addAffine(scratch[0], S[i], G[i], H[i], d[iBoth[i]]);
  }
  for (let j = 0; j < nDouble; j++) {
    let i = iDouble[j];
    doubleAffine(scratch, S[i], G[i], d[iBoth[i]]);
  }
}

/**
 * Like {@link batchAddUnsafe}, but uses less memory.
 */
function batchAddUnsafeNew(
  Field: MsmField,
  [delta, I, ...scratch]: number[],
  S: Uint32Array,
  G: Uint32Array,
  H: Uint32Array,
  n: number
) {
  let { sizeField, subtractPositive, addAffine, multiply } = Field;

  if (n === 0) return;

  using _ = Field.local.atCurrentOffset;
  let z0 = Field.local.getPointer(n * sizeField);

  // z[0] = (H[0] - G[0])
  subtractPositive(z0, H[0], G[0]);

  let zi = z0;
  for (let i = 1; i < n; i++, zi += sizeField) {
    // z[i] = z[i-1] (H[i] - G[i]) = Prod_{j<=i} (H[j] - G[j])
    subtractPositive(delta, H[i], G[i]);
    multiply(zi + sizeField, delta, zi);
  }

  // I = 1/z[n-1] = Prod_{j<=n-1} (H[j] - G[j])^(-1)
  Field.inverse(scratch[0], I, zi);

  let invDelta = delta;
  zi -= sizeField;
  for (let i = n - 1; i > 0; i--, zi -= sizeField) {
    // invDelta = (H[i] - G[i])^(-1)
    multiply(invDelta, I, zi);
    addAffine(scratch[0], S[i], G[i], H[i], invDelta);

    // I = I * (H[i] - G[i]) = Prod_{j<i} (H[j] - G[j])^(-1)
    subtractPositive(delta, H[i], G[i]);
    multiply(I, I, delta);
  }
  // I = (H[0] - G[0])^(-1)
  addAffine(scratch[0], S[0], G[0], H[0], I);
}

/**
 * Given points G0,...,G(n-1) and H0,...,H(n-1), compute
 *
 * Si = Gi + Hi, i=0,...,n-1
 *
 * @param {number[]} scratch
 * @param {Uint32Array} tmp pointers of length n
 * @param {Uint32Array} d pointers of length n
 * @param {Uint32Array} S
 * @param {Uint32Array} G
 * @param {Uint32Array} H
 * @param {number} n
 */
function batchAdd(
  Field: MsmField,
  Curve: CurveAffine,
  scratch: number[],
  tmp: Uint32Array,
  d: Uint32Array,
  S: Uint32Array,
  G: Uint32Array,
  H: Uint32Array,
  n: number
) {
  let { sizeField, subtractPositive, batchInverse, addAffine, isEqual, add } =
    Field;
  let {
    double: doubleAffine,
    isZero: isZeroAffine,
    copy: copyAffine,
    setIsNonZero: setIsNonZeroAffine,
  } = Curve;

  let iAdd = Array(n);
  let iDouble = Array(n);
  let iBoth = Array(n);
  let nAdd = 0;
  let nDouble = 0;
  let nBoth = 0;

  for (let i = 0; i < n; i++) {
    // check G, H for zero
    if (isZeroAffine(G[i])) {
      copyAffine(S[i], H[i]);
      continue;
    }
    if (isZeroAffine(H[i])) {
      if (S[i] !== G[i]) copyAffine(S[i], G[i]);
      continue;
    }
    if (isEqual(G[i], H[i])) {
      // here, we handle the x1 === x2 case, in which case (x2 - x1) shouldn't be part of batch inversion
      // => batch-affine doubling G[p] in-place for the y1 === y2 cases, setting G[p] zero for y1 === -y2
      let y = G[i] + sizeField;
      if (!isEqual(y, H[i] + sizeField)) {
        setIsNonZeroAffine(S[i], false);
        continue;
      }
      add(tmp[nBoth], y, y); // TODO: efficient doubling
      iDouble[nDouble] = i;
      iBoth[i] = nBoth;
      nDouble++, nBoth++;
    } else {
      // typical case, where x1 !== x2 and we add the points
      subtractPositive(tmp[nBoth], H[i], G[i]);
      iAdd[nAdd] = i;
      iBoth[i] = nBoth;
      nAdd++, nBoth++;
    }
  }
  batchInverse(scratch[0], d[0], tmp[0], nBoth);
  for (let j = 0; j < nAdd; j++) {
    let i = iAdd[j];
    addAffine(scratch[0], S[i], G[i], H[i], d[iBoth[i]]);
  }
  for (let j = 0; j < nDouble; j++) {
    let i = iDouble[j];
    doubleAffine(scratch, S[i], G[i], d[iBoth[i]]);
  }
}

/**
 * Given points G0,...,G(n-1) and H0,...,H(n-1), compute
 *
 * Si = Gi + Hi, i=0,...,n-1
 *
 * unsafe: this is a faster version which doesn't handle edge cases!
 * it assumes all the Gi, Hi are non-zero and we won't hit cases where Gi === +/-Hi
 *
 * this is a valid assumption in parts of the msm, for important applications like the prover side of a commitment scheme like KZG or IPA,
 * where inputs are independent and pseudo-random in significant parts of the msm algorithm
 * (we always use the safe version in those parts of the msm where the chance of edge cases is non-negligible)
 *
 * the performance improvement is in the ballpark of 5%
 *
 * @param scratch
 * @param tmp pointers of length n
 * @param d pointers of length n
 * @param S
 * @param G
 * @param H
 * @param n
 */
function batchAddUnsafe(
  Field: MsmField,
  scratch: number[],
  tmp: number,
  d: number,
  S: Uint32Array,
  G: Uint32Array,
  H: Uint32Array,
  n: number
) {
  let { sizeField, subtractPositive, batchInverse, addAffine } = Field;

  for (let i = 0, tmpi = tmp; i < n; i++, tmpi += sizeField) {
    subtractPositive(tmpi, H[i], G[i]);
  }
  batchInverse(scratch[0], d, tmp, n);
  for (let i = 0, di = d; i < n; i++, di += sizeField) {
    addAffine(scratch[0], S[i], G[i], H[i], di);
  }
}

/**
 * Given points G0,...,G(n-1), compute
 *
 * Gi *= 2, i=0,...,n-1
 *
 * @param {number[]} scratch
 * @param {Uint32Array} tmp pointers of length n
 * @param {Uint32Array} d pointers of length n
 * @param {Uint32Array} G
 * @param {number} n
 */
function batchDoubleInPlace(
  Field: MsmField,
  Curve: CurveAffine,
  scratch: number[],
  tmp: Uint32Array,
  d: Uint32Array,
  G: Uint32Array,
  n: number
) {
  let { sizeField, batchInverse, add } = Field;
  let { double: doubleAffine, isZero: isZeroAffine } = Curve;
  // maybe every curve point should have space for one extra field element so we have those tmp pointers ready?

  // check G for zero
  let G1 = Array(n);
  let n1 = 0;
  for (let i = 0; i < n; i++) {
    if (isZeroAffine(G[i])) continue;
    G1[n1] = G[i];
    // TODO: confirm that y === 0 can't happen, either bc 0 === x^3 + 4 has no solutions in the field or bc the (x,0) aren't in G1
    let y = G1[n1] + sizeField;
    add(tmp[n1], y, y); // TODO: efficient doubling
    n1++;
  }
  batchInverse(scratch[0], d[0], tmp[0], n1);
  for (let i = 0; i < n1; i++) {
    doubleAffine(scratch, G1[i], G1[i], d[i]);
  }
}
