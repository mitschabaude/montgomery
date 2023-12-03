// fast random point generation

import type { MsmCurve } from "./msm.js";
import { assert, randomBytes } from "./util.js";

export { createRandomPointsFast };

function createRandomPointsFast(msmCurve: MsmCurve) {
  /**
   * Generate n random points on the curve with given entropy
   *
   * Note: these points are usable for testing, but not as a safe point basis for commitments.
   * That's because they are generated from a much smaller basis scaled by known exponents.
   *
   * @param n number of points to generate
   * @param entropy number of random bits we generate each point from
   */
  return function randomPointsFast(
    n: number,
    { entropy = 64, windowSize = 13 } = {}
  ) {
    let { Field, CurveAffine, CurveProjective } = msmCurve;
    let pointsAffine = Field.getPointers(n, CurveAffine.sizeAffine);
    let offset = Field.getOffset();
    let scratch = Field.getPointers(40);

    // split entropy into k windows of size c
    let c = windowSize;
    let K = Math.ceil(entropy / c);

    // 1. generate a random basis of size k
    let basis = Field.getPointers(K, CurveAffine.sizeAffine);
    CurveAffine.randomPoints(scratch, basis);

    // 2. precompute multiples of each basis point: G, ..., 2^c*G
    let L = 1 << c;
    let B = basis.map((Bk1) => {
      let Bk = Field.getPointers(L, CurveProjective.sizeProjective);

      // zeroth point is zero
      CurveProjective.setZero(Bk[0]);
      // first point is the basis point
      CurveProjective.affineToProjective(Bk[1], Bk1);
      // second needs double
      CurveProjective.copy(Bk[2], Bk[1]);
      CurveProjective.doubleInPlace(scratch, Bk[2]);
      // the rest with additions
      for (let l = 3; l < L; l++) {
        CurveProjective.copy(Bk[l], Bk[l - 1]);
        CurveProjective.addAssign(scratch, Bk[l], Bk[1]);
      }
      return Bk;
    });

    // 3. generate random points by taking a sum of random basis multiples
    let points = Field.getPointers(n, CurveProjective.sizeProjective);

    for (let i = 0; i < n; i++) {
      let windows = randomWindows(c, K);
      let P = points[i];
      CurveProjective.copy(P, B[0][windows[0]]);
      for (let k = 1; k < K; k++) {
        let l = windows[k];
        CurveProjective.addAssign(scratch, P, B[k][l]);
      }
    }

    // 4. convert to affine
    CurveAffine.batchFromProjective(scratch, pointsAffine, points);

    Field.setOffset(offset);
    return pointsAffine;
  };
}

// console.log(pointsAffine.map((P) => CurveAffine.toBigint(P)));

function randomWindows(c: number, K: number) {
  assert(c <= 16, "can generate a window from 2 bytes");
  let cMask = (1 << c) - 1;
  let windows: number[] = new Array(K);
  let bytes = randomBytes(2 * K);
  for (let k = 0; k < K; k++) {
    windows[k] = (bytes[2 * k] + 256 * bytes[2 * k + 1]) & cMask;
  }
  return windows;
}
