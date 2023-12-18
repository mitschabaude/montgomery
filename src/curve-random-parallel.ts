// fast random point generation

import type { MsmCurve } from "./msm.js";
import { THREADS, isMain, thread } from "./threads/threads.js";
import { assert, randomBytes } from "./util.js";

export { createRandomPointsFast };

function createRandomPointsFast(msmCurve: Omit<MsmCurve, "Scalar">) {
  /**
   * Generate n random points on the curve with given entropy
   *
   * Note: these points are usable for testing, but not as a safe point basis for commitments.
   * That's because they are generated from a much smaller basis scaled by known exponents.
   *
   * @param n number of points to generate
   * @param entropy number of random bits we generate each point from
   */
  return async function randomPointsFast(
    n: number,
    { entropy = 64, windowSize = 13 } = {}
  ) {
    let { Field, CurveAffine, CurveProjective } = msmCurve;
    let pointsAffine = Field.global.getPointers(n, CurveAffine.sizeAffine);
    using _l = Field.local.atCurrentOffset;
    using _g = Field.global.atCurrentOffset;

    let syncArray = Field.global.getLocks();

    let scratch = Field.local.getPointers(40);

    // split entropy into k windows of size c
    let c = windowSize;
    let K = Math.ceil(entropy / c);

    // 1. generate a random basis of size k
    let basis = Field.global.getPointers(K, CurveAffine.sizeAffine);

    if (isMain()) {
      CurveAffine.randomPoints(scratch, basis);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    await syncThreads(syncArray);

    // 2. precompute multiples of each basis point: G, ..., 2^c*G
    let L = 1 << c;
    let B = basis.map((Bk1) => {
      let Bk = Field.global.getPointers(L, CurveProjective.sizeProjective);

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
    let points = Field.global.getPointers(n, CurveProjective.sizeProjective);

    for (let i = 0; i < n; i++) {
      let windows = randomWindows(c, K);
      let P = points[i];
      CurveProjective.copy(P, B[0][windows[0]]);
      for (let k = 1; k < K; k++) {
        let l = windows[k];
        CurveProjective.addAssign(scratch, P, B[k][l]);
      }
    }
    await syncThreads(syncArray);

    // 4. convert to affine
    CurveAffine.batchFromProjective(scratch, pointsAffine, points);

    return pointsAffine;
  };
}

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

async function syncThreads(syncArray: Int32Array) {
  console.log(`before sync #${count} at thread ${thread}`);
  syncArray[thread] = count + 1;
  Atomics.notify(syncArray, thread);
  await Promise.all(
    Array.from({ length: THREADS }, (_, t) => {
      if (t === thread) return;
      return Atomics.waitAsync(syncArray, t, count).value;
    })
  );
  console.log(`after sync #${count} at thread ${thread}`);
  count++;
}

let count = 0;
