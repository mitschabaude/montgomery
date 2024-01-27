// fast random point generation

import type { MsmCurve } from "./msm.js";
import { barrier, range, shareOf } from "./threads/threads.js";
import { assert, bigintFromBytes32, log2, randomBytes } from "./util.js";
import { MemoryHelpers } from "./wasm/memory-helpers.js";

export { createRandomPointsFast, createRandomScalars };

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

    let pointsAffine = Field.global.getPointers(n, CurveAffine.size);
    using _l = Field.local.atCurrentOffset;
    using _g = Field.global.atCurrentOffset;

    let scratch = Field.local.getPointers(40);

    // split entropy into k windows of size c
    let c = windowSize;
    let K = Math.ceil(entropy / c);

    // 1. precompute basis point G and multiples: 0, G, ..., (2^c-1)*G
    let L = 1 << c;
    let B = Array<number[]>(K);
    for (let k = 0; k < K; k++) {
      B[k] = Field.global.getPointers(L, CurveProjective.size);
    }
    for (let [k, ke] = range(K); k < ke; k++) {
      // compute random basis point
      let basis = Field.local.getPointer(CurveAffine.size);
      CurveAffine.randomPoints([basis]);

      let Bk = B[k];

      // zeroth point is zero
      CurveProjective.setZero(Bk[0]);
      // first point is the basis point
      CurveProjective.fromAffine(Bk[1], basis);
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
    await barrier();

    // 2. generate random points by taking a sum of random basis multiples
    let points = Field.global.getPointers(n, CurveProjective.size);

    for (let [i, ie] = range(n); i < ie; i++) {
      let windows = randomWindows(c, K);
      let P = points[i];
      CurveProjective.copy(P, B[0][windows[0]]);
      for (let k = 1; k < K; k++) {
        let l = windows[k];
        CurveProjective.addAssign(scratch, P, B[k][l]);
      }
    }

    // 3. convert to affine
    let [start, end] = range(n);
    CurveAffine.batchNormalize(
      pointsAffine.slice(start, end),
      points.slice(start, end)
    );
    await barrier();

    return pointsAffine;
  };
}

function createRandomScalars(msmCurve: Pick<MsmCurve, "Scalar">) {
  return createRandomFields256(msmCurve.Scalar);
}

function createRandomFields256(
  Field: {
    modulus: bigint;
    fromPackedBytes: (x: number, bytes: number) => void;
  } & MemoryHelpers
) {
  let p = Field.modulus;
  let sizeInBits = log2(p);
  let size = Math.ceil(sizeInBits / 8);
  assert(size === 32, "only supports 32-byte fields");
  let sizeHighestByte = sizeInBits - 8 * (size - 1);
  let msbMask = (1 << sizeHighestByte) - 1;

  return async function randomFields(n: number) {
    let fields = Field.global.getPointers(n);
    using _ = Field.local.atCurrentOffset;
    let scratchPtr = Field.local.getPointer(size);
    let scratchBytes = new Uint8Array(
      Field.memoryBytes.buffer,
      scratchPtr,
      size
    );

    let N = shareOf(n) * size * 2; // x2 to have buffer for rejected samples
    let bytes = randomBytes(N);
    let nBytesUsed = 0;

    for (let [i, iend] = range(n); i < iend; i++) {
      while (true) {
        if (nBytesUsed + size > N) {
          bytes = randomBytes(N);
          nBytesUsed = 0;
        }
        let bytes_ = bytes.subarray(nBytesUsed, nBytesUsed + size);
        bytes_[size - 1] &= msbMask;
        nBytesUsed += size;
        // TODO test > on bytes directly
        let x = bigintFromBytes32(bytes_);
        if (x < p) {
          scratchBytes.set(bytes_);
          Field.fromPackedBytes(fields[i], scratchPtr);
          break;
        }
      }
    }
    await barrier();
    return fields;
  };
}

function randomWindows(c: number, K: number) {
  assert(c <= 24, "can generate a window from 3 bytes");
  let cMask = (1 << c) - 1;
  let windows: number[] = new Array(K);
  let bytes = randomBytes(3 * K);
  for (let k = 0; k < K; k++) {
    windows[k] =
      (bytes[2 * k] + (bytes[2 * k + 1] << 8) + (bytes[2 * k + 2] << 16)) &
      cMask;
  }
  return windows;
}
