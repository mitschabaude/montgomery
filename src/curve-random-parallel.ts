// fast random point generation

import { tic, toc } from "./extra/tictoc.web.js";
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

    ticMain("random basis");
    if (isMain()) {
      CurveAffine.randomPoints(scratch, basis);
    }
    tocMain();
    await syncThreads(syncArray);

    // 2. precompute multiples of each basis point: G, ..., 2^c*G
    ticMain("precompute multiples");
    let L = 1 << c;
    let B = Array<number[]>(K);
    for (let k = 0; k < K; k++) {
      B[k] = Field.global.getPointers(L, CurveProjective.sizeProjective);
    }
    for (let [k, ke] = range(K); k < ke; k++) {
      let Bk1 = basis[k];
      let Bk = B[k];

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
      B[k] = Bk;
    }
    tocMain();
    ticMain("precompute multiples (wait)");
    await syncThreads(syncArray);
    tocMain();

    // 3. generate random points by taking a sum of random basis multiples
    ticMain("random points");
    let points = Field.global.getPointers(n, CurveProjective.sizeProjective);

    for (let [i, ie] = range(n); i < ie; i++) {
      let windows = randomWindows(c, K);
      let P = points[i];
      CurveProjective.copy(P, B[0][windows[0]]);
      for (let k = 1; k < K; k++) {
        let l = windows[k];
        CurveProjective.addAssign(scratch, P, B[k][l]);
      }
    }
    tocMain();
    ticMain("random points (wait)");
    await syncThreads(syncArray);
    tocMain();

    // 4. convert to affine
    ticMain("convert to affine");
    if (isMain()) {
      CurveAffine.batchFromProjective(scratch, pointsAffine, points);
    }
    tocMain();

    return pointsAffine;
  };
}

function randomWindows(c: number, K: number) {
  assert(c <= 24, "can generate a window from 3 bytes");
  let cMask = (1 << c) - 1;
  let windows: number[] = new Array(K);
  let bytes = randomBytes(3 * K);
  for (let k = 0; k < K; k++) {
    windows[k] =
      (bytes[2 * k] + 256 * bytes[2 * k + 1] + 256 ** 2 * bytes[2 * k + 2]) &
      cMask;
  }
  return windows;
}

async function syncThreads(syncArray: Int32Array) {
  console.log(`${thread}: syncing ${count}`);
  Atomics.store(syncArray, thread, count + 1);
  Atomics.notify(syncArray, thread);
  await Promise.all(
    Array.from({ length: THREADS }, (_, t) => {
      if (t === thread) return;
      return Atomics.waitAsync(syncArray, t, count).value;
    })
  );
  // console.log(`${thread}: syncing ${count} (after)`);
  count++;
}
let count = 0;

function range(n: number) {
  let nt = Math.floor(n / THREADS);
  let start = thread * nt;
  let end = thread === THREADS - 1 ? n : start + nt;
  return [start, end];
}

function rangeMain(n: number) {
  if (isMain()) return [0, n];
  return [0, 0];
}

function ticMain(s: string) {
  if (isMain()) tic(s);
}
function tocMain() {
  if (isMain()) toc();
}
