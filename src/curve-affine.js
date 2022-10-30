import {
  getPointers,
  n,
  memoryBytes,
  getZeroPointers,
  writeBytes,
  toMontgomery,
  resetPointers,
  constants,
  readBigInt,
  fromMontgomery,
  getPointer,
  p,
  mod,
  getAndResetOpCounts,
  addAffine,
  readBytes,
  getPointersInMemory,
  getEmptyPointersInMemory,
} from "./finite-field.js";
import {
  multiply,
  square,
  copy,
  subtract,
  add,
  isEqual,
  subtractPositive,
  inverse,
  endomorphism,
  batchInverse,
  batchAddUnsafe,
} from "./finite-field.wat.js";
import {
  decompose,
  scratchPtr,
  writeBytesScalar,
  scalarSize,
  packedScalarSize,
  readBytesScalar,
  memoryScalar,
  getPointerScalar,
} from "./scalar-glv.js";
import { extractBitSlice, log2 } from "./util.js";

export { msmAffine, batchAdd };

/**
 * @typedef {number} AffinePoint
 * @typedef {number} ProjectivePoint
 * @typedef {[xArray: Uint8Array, yArray: Uint8Array, isInfinity: boolean]} CompatiblePoint
 */

/**
 * affine point is represented as pointer p, where
 * x = p
 * y = p + fieldSize
 * isInfinity = p + 2*fieldSize
 *
 * if the point is projective, we have x, y as before and
 * z = p + 2*fieldSize
 * isInfinity = p + 3*fieldSize
 */

let sizeField = 8 * n;
let sizeAffine = 16 * n + 8; // size of one affine point in Wasm memory: x, y + 1 int64 for extra info (0 = isZero, >0 = isFilled)
let sizeProjective = 24 * n + 8;

let cTable = {
  [14]: [13, 8],
  [16]: [13, 9],
  [18]: [16, 9],
};

/**
 *
 * @param {CompatibleScalar[]} inputScalars
 * @param {CompatiblePoint[]} inputPoints
 */
function msmAffine(inputScalars, inputPoints, { c: c_, c0: c0_ } = {}) {
  // initialize buckets
  let N = inputScalars.length;

  let n = log2(N);
  let c = n - 1;
  if (c < 1) c = 1;
  let c0 = c >> 1;
  [c, c0] = cTable[n] || [c, c0];
  // if parameters for c and c0 were passed in, use those instead
  if (c_) c = c_;
  if (c0_) c0 = c0_;

  let K = Math.ceil(129 / c); // number of partitions
  let L = 2 ** (c - 1); // number of buckets per partition, -1 (we'll skip the 0 bucket, but will have them in the array at index 0 to simplify access)
  let doubleL = 2 * L;

  let sizeAffine2 = 2 * sizeAffine;
  let sizeAffine4 = 4 * sizeAffine;
  let pointPtr = getPointer(N * sizeAffine4);
  let scalarPtr = getPointerScalar(N * packedScalarSize);

  /**
   * @type {(number)[][]}
   */
  let bucketCounts = Array(K);
  for (let k = 0; k < K; k++) {
    bucketCounts[k] = Array(L + 1);
    for (let l = 0; l <= L; l++) {
      bucketCounts[k][l] = 0;
    }
  }
  let scratch = getPointers(30);

  let maxBucketSize = 0;
  let nPairs = 0; // we need to allocate space for one pointer per addition pair

  getAndResetOpCounts();

  /**
   * PREPARATION PHASE 1
   *
   * -) store points into our wasm memory, as w*n limbs we need
   * -) also compute & store negative, endo, and negative-endo points
   * -) decompose scalars s = s0 + lambda*s1 and store s0, s1
   * -) walk over the c-bit windows of each scalar, to
   *    > count the number of points for each bucket
   *    > count the total number of pairs to add in the first batch addition
   *
   * note: actual bucket organization is done separately; here, we just count bucket sizes, as first step of a counting sort
   */
  for (
    let i = 0, point = pointPtr, scalar = scalarPtr;
    i < N;
    i++, point += sizeAffine4
  ) {
    let inputScalar = inputScalars[i];
    let inputPoint = inputPoints[i];
    let negPoint = point + sizeAffine;
    let endoPoint = negPoint + sizeAffine;
    let negEndoPoint = endoPoint + sizeAffine;
    // convert point to montgomery
    let x = point;
    let y = point + sizeField;
    writeBytes(scratch, x, inputPoint[0]);
    writeBytes(scratch, y, inputPoint[1]);
    let isNonZero = Number(!inputPoint[2]);
    memoryBytes[point + 2 * sizeField] = isNonZero;
    toMontgomery(x);
    toMontgomery(y);

    // -point, endo(point), -endo(point)
    copy(negPoint, x);
    subtract(negPoint + sizeField, constants.p, y); // TODO efficient negation
    memoryBytes[negPoint + 2 * sizeField] = isNonZero;
    endomorphism(endoPoint, point);
    memoryBytes[endoPoint + 2 * sizeField] = isNonZero;
    copy(negEndoPoint, endoPoint);
    copy(negEndoPoint + sizeField, negPoint + sizeField);
    memoryBytes[negEndoPoint + 2 * sizeField] = isNonZero;

    // decompose scalar from one 32-byte into two 16-byte chunks
    writeBytesScalar(scratchPtr, inputScalar);
    decompose(scratchPtr);
    let scalar0 = readBytesScalar(scalar, scratchPtr);
    scalar += packedScalarSize;
    let scalar1 = readBytesScalar(scalar, scratchPtr + scalarSize);
    scalar += packedScalarSize;

    // partition each 16-byte scalar into c-bit digits
    for (let k = 0, carry0 = 0, carry1 = 0; k < K; k++) {
      // compute kth digit from first half scalar
      let l = extractBitSlice(scalar0, k * c, c) + carry0;
      if (l > L) {
        l = doubleL - l;
        carry0 = 1;
      } else {
        carry0 = 0;
      }
      if (l !== 0) {
        // if the digit is non-zero, increase bucket count
        let bucketSize = ++bucketCounts[k][l];
        if ((bucketSize & 1) === 0) nPairs++;
        if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
      }
      // compute kth digit from second half scalar
      l = extractBitSlice(scalar1, k * c, c) + carry1;
      if (l > L) {
        l = doubleL - l;
        carry1 = 1;
      } else {
        carry1 = 0;
      }
      if (l !== 0) {
        let bucketSize = ++bucketCounts[k][l];
        if ((bucketSize & 1) === 0) nPairs++;
        if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
      }
    }
  }
  /**
   * PREPARATION PHASE 2
   */
  let bucketPointers = Array(K);
  for (let k = 0; k < K; k++) {
    bucketPointers[k] = getPointer(2 * N * sizeAffine);
  }
  /**
   * @type {number[][][]}
   */
  let buckets = Array(K);
  for (let k = 0; k < K; k++) {
    let ptr = bucketPointers[k];
    buckets[k] = Array(L + 1);
    buckets[k][0] = [];
    for (let l = 1; l <= L; l++) {
      let count = bucketCounts[k][l];
      let bucket = Array(count);
      for (let i = 0; i < count; i++) {
        bucket[i] = ptr;
        ptr += sizeAffine;
      }
      buckets[k][l] = bucket;
    }
  }
  // integrate bucket counts to become start indices
  for (let k = 0; k < K; k++) {
    let counts = bucketCounts[k];
    let running = 0;
    for (let l = 1; l <= L; l++) {
      let count = counts[l];
      counts[l] = running;
      running += count;
    }
  }
  // copy points to contiguous locations, to optimize memory access
  for (
    let i = 0, point = pointPtr, scalar = scalarPtr;
    i < 2 * N;
    i++, point += sizeAffine2, scalar += packedScalarSize
  ) {
    let negPoint = point + sizeAffine;
    let scalarBytes = new Uint8Array(
      memoryScalar.buffer,
      scalar,
      packedScalarSize
    );
    let carry = 0;
    // recomputing the scalar slices here is faster than storing them
    for (let k = 0; k < K; k++) {
      let l = extractBitSlice(scalarBytes, k * c, c) + carry;
      if (l > L) {
        l = doubleL - l;
        carry = 1;
      } else {
        carry = 0;
      }
      let ptr0 = bucketPointers[k];
      if (l === 0) continue;
      let l0 = bucketCounts[k][l]++;
      let newPtr = ptr0 + l0 * sizeAffine;
      let ptr = carry === 1 ? negPoint : point;
      copyAffine(newPtr, ptr);
    }
  }

  let [G, gPtr] = getEmptyPointersInMemory(nPairs); // holds first summands
  let [H, hPtr] = getEmptyPointersInMemory(nPairs); // holds second summands
  let [denom] = getPointersInMemory(nPairs);
  let [tmp] = getPointersInMemory(nPairs);

  // first stage
  // batch-add buckets into their first point, in `maxBucketSize` iterations

  // first iteration -- a bit different than the others, because we use a third point as the addition result
  let m = 1;
  // only do this if there are any pairs...
  if (m < maxBucketSize) {
    let p = 0;
    // walk over all buckets to identify point-pairs to add
    for (let k = 0; k < K; k++) {
      for (let l = 1; l <= L; l++) {
        let x = buckets[k][l];
        let bucketSize = x.length;
        for (let i = 0; i + 1 < bucketSize; i += 2) {
          G[p] = x[i];
          H[p] = x[i + 1];
          p++;
        }
      }
    }
    // now (P,G,H) represents a big array of independent additions, which we batch-add
    batchAddUnsafe(scratch[0], tmp[0], denom[0], gPtr, gPtr, hPtr, nPairs);
  }
  // now let's repeat until we summed all buckets into one element
  for (m *= 2; m < maxBucketSize; m *= 2) {
    let p = 0;
    // walk over all buckets to identify point-pairs to add
    for (let k = 0; k < K; k++) {
      for (let l = 1; l <= L; l++) {
        let x = buckets[k][l];
        let bucketSize = x.length;
        for (let i = 0; i + m < bucketSize; i += 2 * m) {
          G[p] = x[i];
          H[p] = x[i + m];
          p++;
        }
      }
    }
    // update number of pairs to add
    nPairs = p;
    // now (G,H) represents a big array of independent additions, which we batch-add
    // this time, we add with assignment since the left summands G are not original points
    batchAddUnsafe(scratch[0], tmp[0], denom[0], gPtr, gPtr, hPtr, nPairs);
  }
  // we're done!!
  // buckets[k][l][0] now contains the bucket sum, or undefined for empty buckets

  let [nMul1, nInv1] = getAndResetOpCounts();

  // second stage
  // let partialSums = reduceBucketsSimple(scratchSpace, buckets, { K, L });
  let partialSums = reduceBucketsAffine(scratch, buckets, { c, c0, K, L });

  let [nMul2, nInv2] = getAndResetOpCounts();

  // third stage -- compute final sum using horner's rule
  let finalSum = getPointer(sizeProjective);
  let k = K - 1;
  let partialSum = partialSums[k];
  copyProjective(finalSum, partialSum);
  k--;
  for (; k >= 0; k--) {
    for (let j = 0; j < c; j++) {
      doubleInPlaceProjective(scratch, finalSum);
    }
    let partialSum = partialSums[k];
    addAssignProjective(scratch, finalSum, partialSum);
  }

  // convert final sum back to affine point
  let result = toAffineOutput(scratch, finalSum);

  let [nMul3, nInv3] = getAndResetOpCounts();

  resetPointers();

  return {
    result,
    nMul1,
    nMul2,
    nMul3,
    nInv: nInv1 + nInv2 + nInv3,
  };
}

/**
 * reducing buckets into one sum per partition, using only batch-affine additions & doublings
 *
 * @param {number[]} scratch
 * @param {number[][][]} oldBuckets
 * @param {{c: number, K: number, L: number}}
 * @param {number} depth
 */
function reduceBucketsAffine(scratch, oldBuckets, { c, c0, K, L }) {
  // D = 1 is the standard algorithm, just batch-added over the K partitions
  // D > 1 means that we're doing D * K = n adds at a time
  // => more efficient than doing just K at a time, since we amortize the cost of the inversion better
  let depth = c - 1 - c0;
  let D = 2 ** depth;
  let n = D * K;
  let L0 = 2 ** c0; // == L/D

  let [d] = getPointersInMemory(K * L, sizeField);
  let [tmp] = getPointersInMemory(K * L, sizeField);

  // normalize the way buckets are stored -- we'll store intermediate running sums there
  // copy bucket sums into new contiguous pointers to improve memory access
  /** @type {number[][]} */
  let buckets = Array(K);
  for (let k = 0; k < K; k++) {
    let oldBucketsK = oldBuckets[k];
    let bucketsK = getZeroPointers(L + 1, sizeAffine);
    buckets[k] = bucketsK;
    for (let l = 1; l <= L; l++) {
      let oldBucket = oldBucketsK[l];
      if (oldBucket.length === 0) continue;
      let ptr = oldBucket[0];
      let newPtr = bucketsK[l];
      copyAffine(newPtr, ptr);
    }
  }

  let [runningSums] = getEmptyPointersInMemory(n);
  let [nextBuckets] = getEmptyPointersInMemory(n);

  // linear part of running sum computation / sums of the form x_(d*L0 + L0) + x(d*L0 + (L0-1)) + ...x_(d*L0 + 1), for d=0,...,D-1
  for (let l = L0 - 1; l > 0; l--) {
    // collect buckets to add into running sums
    let p = 0;
    for (let k = 0; k < K; k++) {
      for (let d = 0; d < D; d++, p++) {
        runningSums[p] = buckets[k][d * L0 + l + 1];
        nextBuckets[p] = buckets[k][d * L0 + l];
      }
    }
    // console.assert(p === n);
    // add them; we add-assign the running sum to the next bucket and not the other way;
    // building up a list of intermediary partial sums at the pointers that were the buckets before
    batchAdd(scratch, tmp, d, nextBuckets, nextBuckets, runningSums, n);
  }

  // logarithmic part (i.e., logarithmic # of batchAdds / inversions; the # of EC adds is linear in K*D = K * 2^(c - c0))
  // adding x_(d*2*L0 + 1) += x_((d*2 + 1)*L0 + 1), d = 0,...,D/2-1,  x_(d*2(2*L0) + 1) += x_((d*2 + 1)*(2*L0) + 1), d = 0,...,D/4-1, ...
  // until x_(d*2*2**(depth-1)*L0 + 1) += x_((d*2 + 1)*2**(depth-1)*L0 + 1), d = 0,...,(D/2^depth - 1) = 0
  // <===> x_1 += x_(L/2 + 1)
  // iterate over L1 = 2^0*L0, 2^1*L0, ..., 2^(depth-1)*L0 (= L/2) and D1 = 2^(depth-1), 2^(depth-2), ..., 2^0
  // (no-op if 2^(depth-1) < 1 <===> depth = 0)
  let minorSums = runningSums;
  let majorSums = nextBuckets;
  for (let L1 = L0, D1 = D >> 1; D1 > 0; L1 <<= 1, D1 >>= 1) {
    let p = 0;
    for (let k = 0; k < K; k++) {
      for (let d = 0; d < D1; d++, p++) {
        minorSums[p] = buckets[k][(d * 2 + 1) * L1 + 1];
        majorSums[p] = buckets[k][d * 2 * L1 + 1];
      }
    }
    // console.assert(p === K * D1);
    batchAdd(scratch, tmp, d, majorSums, majorSums, minorSums, p);
  }
  // second logarithmic step: repeated doubling of some buckets until they hold square areas to fill up the triangle
  // first, double x_(d*L0 + 1), d=1,...,D-1, c0 times, so they all hold 2^c0 * x_(d*L0 + 1)
  // (no-op if depth=0 / D=1 / c0=c)
  let p = 0;
  for (let k = 0; k < K; k++) {
    for (let d = 1; d < D; d++, p++) {
      minorSums[p] = buckets[k][d * L0 + 1];
    }
  }
  // console.assert(p === K * (D - 1));
  if (D > 1) {
    for (let j = 0; j < c0; j++) {
      batchDoubleInPlace(scratch, tmp, d, minorSums, p);
    }
  }
  // now, double successively smaller sets of buckets until the biggest is 2^(c-1) * x_(2^(c-1) + 1)
  // x_(d*L0 + 1), d=2,4,...,D-2 / d=4,8,...,D-4 / ... / d=D/2 = 2^(c - c0 - 1)
  // (no-op if depth = 0, 1)
  for (let L1 = 2 * L0, D1 = D >> 1; D1 > 1; L1 <<= 1, D1 >>= 1) {
    let p = 0;
    for (let k = 0; k < K; k++) {
      for (let d = 1; d < D1; d++, p++) {
        majorSums[p] = buckets[k][d * L1 + 1];
      }
    }
    batchDoubleInPlace(scratch, tmp, d, majorSums, p);
  }

  // alright! now our buckets precisely fill up the big triangle
  // => sum them all in a big addition tree
  // we always batchAdd a list of pairs into the first element of each pair
  // round 0: (1,2), (3,4), (5,6), ..., (L-1, L);
  //      === (l,l+1) for l=1; l<L; i+=2
  // round 1: (l,l+2) for l=1; l<L; i+=4
  // round j: let m=2^j; (l,l+m) for l=1; l<L; l+=2*m
  // in the last round we want 1 pair (1, 1 + m=2^(c-1)), so we want m < 2**c = L

  let [G] = getEmptyPointersInMemory(K * L);
  let [H] = getEmptyPointersInMemory(K * L);

  for (let m = 1; m < L; m *= 2) {
    p = 0;
    for (let k = 0; k < K; k++) {
      for (let l = 1; l < L; l += 2 * m, p++) {
        G[p] = buckets[k][l];
        H[p] = buckets[k][l + m];
      }
    }
    batchAdd(scratch, tmp, d, G, G, H, p);
  }

  // finally, return the output sum of each partition as a projective point
  let partialSums = getZeroPointers(K, sizeProjective);
  for (let k = 0; k < K; k++) {
    if (isZeroAffine(buckets[k][1])) continue;
    copyAffineToProjectiveNonZero(partialSums[k], buckets[k][1]);
  }
  return partialSums;
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
 * the performance improvement is in the ballpark of 1-3%
 *
 * @param {number[]} scratch
 * @param {Uint32Array} tmp pointers of length n
 * @param {Uint32Array} d pointers of length n
 * @param {Uint32Array} S
 * @param {Uint32Array} G
 * @param {Uint32Array} H
 * @param {number} n
 */
function batchAddUnsafeJs(scratch, tmp, d, S, G, H, n) {
  for (let i = 0; i < n; i++) {
    subtractPositive(tmp[i], H[i], G[i]);
  }
  batchInverse(scratch[0], d[0], tmp[0], n);
  for (let i = 0; i < n; i++) {
    addAffine(scratch[0], S[i], G[i], H[i], d[i]);
  }
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
function batchAdd(scratch, tmp, d, S, G, H, n) {
  // maybe every curve point should have space for one extra field element so we have those tmp pointers ready?

  // check G, H for zero
  let iAdd = Array(n);
  let iDouble = Array(n);
  let iBoth = Array(n);
  let nAdd = 0;
  let nDouble = 0;
  let nBoth = 0;

  for (let i = 0; i < n; i++) {
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
      // TODO: handle y1 === -y2; right now we just assume y1 === y2
      let y = G[i] + sizeField;
      add(tmp[nBoth], y, y); // TODO: efficient doubling
      iDouble[nDouble] = i;
      iBoth[i] = nBoth;
      nDouble++, nBoth++;
    } else {
      // normal case
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
function batchDoubleInPlace(scratch, tmp, d, G, n) {
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

/**
 * affine EC doubling, H = 2*G
 *
 * assuming d = 1/(2*y) is given, and inputs aren't zero.
 *
 * this supports doubling a point in-place with H === G
 * @param {number[]} scratch
 * @param {AffinePoint} H output point
 * @param {AffinePoint} G input point (x, y)
 * @param {number} d 1/(2y)
 */
function doubleAffine([m, tmp, x2, y2], H, G, d) {
  let [x, y] = affineCoords(G);
  let [xOut, yOut] = affineCoords(H);

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

/**
 * P1 += P2
 * @param {number[]} scratchSpace
 * @param {ProjectivePoint} P1
 * @param {ProjectivePoint} P2
 */
function addAssignProjective(scratch, P1, P2) {
  if (isZeroProjective(P1)) {
    copyProjective(P1, P2);
    return;
  }
  if (isZeroProjective(P2)) return;
  setNonZeroProjective(P1);
  let [x1, y1, z1] = projectiveCoords(P1);
  let [x2, y2, z2] = projectiveCoords(P2);
  let [u1, u2, v1, v2, u, v, vv, vvv, v2vv, w, a] = scratch;

  multiply(u1, y2, z1);
  multiply(u2, y1, z2);
  multiply(v1, x2, z1);
  multiply(v2, x1, z2);

  // x1/z1 = x2/z2  <==>  x1*z2 = x2*z1  <==>  v2 = v1
  if (isEqual(v1, v2) && isEqual(u1, u2)) {
    doubleInPlaceProjective(scratch, P1);
    return;
  }

  subtract(u, u1, u2);
  subtract(v, v1, v2);
  square(vv, v);
  multiply(vvv, vv, v);
  multiply(v2vv, v2, vv);
  multiply(w, z1, z2);

  square(a, u);
  multiply(a, a, w);
  subtract(a, a, vvv);
  subtract(a, a, v2vv);
  subtract(a, a, v2vv);

  multiply(x1, v, a);
  multiply(z1, vvv, w);
  subtract(v2vv, v2vv, a);
  multiply(vvv, vvv, u2);
  multiply(y1, u, v2vv);
  subtract(y1, y1, vvv);
}

/**
 * P *= 2
 * @param {number[]} scratchSpace
 * @param {Point} P
 */
function doubleInPlaceProjective(scratch, P) {
  if (isZeroProjective(P)) return;
  let [X1, Y1, Z1] = projectiveCoords(P);
  let [tmp, w, s, ss, sss, Rx2, Bx4, h] = scratch;
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
  // 2*(B = X1*R), Bx4 = 2*B+2*B
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
  multiply(Z1, sss, constants.mg8);
}

/**
 * @param {number} P
 * @param {number} A
 */
function copyAffineToProjectiveNonZero(P, A) {
  // x,y = x,y
  memoryBytes.copyWithin(P, A, A + 2 * sizeField);
  // z = 1
  memoryBytes.copyWithin(
    P + 2 * sizeField,
    constants.mg1,
    constants.mg1 + sizeField
  );
  // isNonZero = 1
  memoryBytes[P + 3 * sizeField] = 1;
  // isInfinity = isInfinity
  // memoryBytes[P + 3 * sizeField] = memoryBytes[A + 2 * sizeField];
}

/**
 * @param {number[]} scratch
 * @param {Uint32Array} invX inverted fields of at least length n
 * @param {Uint32Array} X fields to invert, at least length n
 * @param {number} n length
 */
function batchInverseJs([I, tmp], invX, X, n) {
  if (n === 0) return;
  if (n === 1) {
    inverse(tmp, invX[0], X[0]);
    return;
  }
  // invX = [_, x0*x1, ..., x0*....*x(n-2), x0*....*x(n-1)]
  // invX[i] = x0*...*xi
  multiply(invX[1], X[1], X[0]);
  for (let i = 2; i < n; i++) {
    multiply(invX[i], invX[i - 1], X[i]);
  }
  // I = 1/(x0*....*x(n-1)) = 1/invX[n-1]
  inverse(tmp, I, invX[n - 1]);

  for (let i = n - 1; i > 1; i--) {
    multiply(invX[i], invX[i - 1], I);
    multiply(I, I, X[i]);
  }
  // now I = 1/(x0*x1)
  multiply(invX[1], X[0], I);
  multiply(invX[0], I, X[1]);
}

/**
 * @param {number[]} scratchSpace
 * @param {ProjectivePoint} point projective representation
 * @returns {CompatiblePoint}
 */
function toAffineOutput([zinv, ...scratchSpace], P) {
  let [x, y, z] = projectiveCoords(P);
  // return x/z, y/z
  inverse(scratchSpace[0], zinv, z);
  multiply(x, x, zinv);
  multiply(y, y, zinv);
  fromMontgomery(x);
  fromMontgomery(y);
  return [readBytes(scratchSpace, x), readBytes(scratchSpace, y), false];
}
/**
 * @param {number[]} scratchSpace
 * @param {ProjectivePoint} point projective representation
 */
function toAffine([zinv, x1, y1, ...scratchSpace], P) {
  let [x, y, z] = projectiveCoords(P);
  // return x/z, y/z
  inverse(scratchSpace[0], zinv, z);
  multiply(x1, x, zinv);
  multiply(y1, y, zinv);
  return [mod(readBigInt(x1), p), mod(readBigInt(y1), p)];
}

/**
 * @param {ProjectivePoint} point projective representation
 */
function toProjectiveOutput(P) {
  let [x, y, z] = projectiveCoords(P);
  fromMontgomery(x);
  fromMontgomery(y);
  fromMontgomery(z);
  return [readBigInt(x), readBigInt(y), readBigInt(z)];
}

/**
 * @param {number} pointer
 */
function isZeroAffine(pointer) {
  return !memoryBytes[pointer + 2 * sizeField];
}
/**
 * @param {number} pointer
 */
function setNonZeroAffine(pointer) {
  memoryBytes[pointer + 2 * sizeField] = 1;
}

/**
 * @param {number} pointer
 */
function isZeroProjective(pointer) {
  return !memoryBytes[pointer + 3 * sizeField];
}
/**
 * @param {number} pointer
 */
function setNonZeroProjective(pointer) {
  memoryBytes[pointer + 3 * sizeField] = 1;
}

/**
 * @param {number} pointer
 */
function affineCoords(pointer) {
  return [pointer, pointer + sizeField];
}
/**
 * @param {number} pointer
 */
function projectiveCoords(pointer) {
  return [pointer, pointer + sizeField, pointer + 2 * sizeField];
}

/**
 *
 * @param {number} target
 * @param {number} source
 */
function copyAffine(target, source) {
  memoryBytes.copyWithin(target, source, source + sizeAffine);
}
/**
 *
 * @param {number} target
 * @param {number} source
 */
function copyProjective(target, source) {
  memoryBytes.copyWithin(target, source, source + sizeProjective);
}

// DEBUGGING STUFF

function readAffine(P) {
  let isZero = isZeroAffine(P);
  let [x, y] = affineCoords(P);
  return {
    x: mod(readBigInt(x), p),
    y: mod(readBigInt(y), p),
    isZero,
  };
}
function readProjective(P) {
  let isZero = isZeroProjective(P);
  let [x, y, z] = projectiveCoords(P);
  return {
    x: readBigInt(x),
    y: readBigInt(y),
    z: readBigInt(z),
    isZero,
  };
}
function readProjectiveAsAffine(scratchSpace, P) {
  let isZero = isZeroProjective(P);
  if (isZero) {
    let [x, y] = projectiveCoords(P);
    return { x: readBigInt(x), y: readBigInt(y), isZero: true };
  }
  let [x1, y1] = toAffine(scratchSpace, P);
  return { x: x1, y: y1, isZero };
}

// FOR DEBUGGING: non-batched affine addition
// (didn't even get this to work so far)

/**
 * @param {number[]} scratchSpace
 * @param {number[][][]} buckets
 * @param {{c: number, K: number, L: number}}
 */
function reduceBucketsSimpleAffine(scratchSpace, buckets, { c, K, L }) {
  let runningSums = getZeroPointers(K, sizeAffine);
  let partialSums = getZeroPointers(K, sizeAffine);

  let xs = Array(L);

  // sum up buckets to partial sums
  for (let l = L - 1; l > 0; l--) {
    for (let k = 0; k < K; k++) {
      let bucket = buckets[k][l][0];
      let runningSum = runningSums[k];
      let partialSum = partialSums[k];
      if (bucket === undefined) {
        addAssignAffineFull(scratchSpace, partialSum, runningSum);
      } else {
        addAssignAffineFull(scratchSpace, runningSum, bucket);
        addAssignAffineFull(scratchSpace, partialSum, runningSum);
      }
    }
  }
  let partialSumsProj = getZeroPointers(K, sizeProjective);
  for (let k = 0; k < K; k++) {
    let G = partialSums[k];
    if (!isZeroAffine(G)) {
      copyAffineToProjectiveNonZero(partialSumsProj[k], G);
    }
  }
  return [partialSums, xs];
}

/**
 * affine EC addition with assignment, G1 = G1 + G2
 * @param {number[]} scratch
 * @param {AffinePoint} G1 (x1, y1)
 * @param {AffinePoint} G2 (x2, y2)
 */
function addAssignAffineFull([m, tmp, d, ...scratch], G1, G2) {
  let [x1, y1] = affineCoords(G1);
  let [x2, y2] = affineCoords(G2);
  if (isZeroAffine(G1)) {
    copyAffine(G1, G2);
    return;
  }
  if (isZeroAffine(G2)) {
    return;
  }
  if (isEqual(x1, x2)) {
    if (isEqual(y1, y2)) {
      doubleInPlaceAffineFull([m, tmp, d, ...scratch], G1);
      return;
    } else {
      throw Error("y1 === -y2");
    }
  }
  // m = (y2 - y1)/(x2 - x1)
  subtract(tmp, x2, x1);
  inverse(scratch[0], d, tmp);
  subtract(m, y2, y1);
  multiply(m, d, m);
  // x1 = m^2 - x1 - x2
  square(tmp, m);
  subtract(x1, tmp, x1);
  subtract(x1, x1, x2);
  // y1 = (x2 - x1)*m - y2
  subtract(y1, x2, x1);
  multiply(y1, y1, m);
  subtract(y1, y1, y2);
}

/**
 * affine EC doubling in place, G *= 2
 * @param {number[]} scratch
 * @param {AffinePoint} G (x, y)
 */
function doubleInPlaceAffineFull([m, tmp, d, x2, y2, ...scratch], G) {
  let [x, y] = affineCoords(G);

  // m = 3*x^2/2y
  add(tmp, y, y);
  inverse(scratch[0], d, tmp);
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
  // x,y = x2,y2
  copy(x, x2);
  copy(y, y2);
}

// OBSOLETE

/**
 * alternative, purely projective version of reducing buckets into partition sums
 *
 * @param {number[]} scratchSpace
 * @param {number[][][]} buckets
 * @param {{c: number, K: number, L: number}}
 */
function reduceBucketsSimple(scratchSpace, buckets, { K, L }) {
  /**
   * @type {number[][]}
   */
  let bucketSums = Array(K);
  for (let k = 0; k < K; k++) {
    bucketSums[k] = getPointers(L + 1, sizeProjective);
  }
  let runningSums = getZeroPointers(K, sizeProjective);
  let partialSums = getZeroPointers(K, sizeProjective);

  // sum up buckets to partial sums
  for (let l = L; l > 0; l--) {
    for (let k = 0; k < K; k++) {
      let bucket = buckets[k][l][0];
      let runningSum = runningSums[k];
      let partialSum = partialSums[k];
      if (bucket === undefined) {
        // bucket sum is zero => running sum stays the same
        addAssignProjective(scratchSpace, partialSum, runningSum);
      } else {
        // bucket sum is affine, we convert to projective here
        let bucketSum = bucketSums[k][l];
        copyAffineToProjectiveNonZero(bucketSum, bucket);
        addAssignProjective(scratchSpace, runningSum, bucketSum);
        addAssignProjective(scratchSpace, partialSum, runningSum);
      }
    }
  }
  return partialSums;
}

/**
 * affine EC addition, G3 = G1 + G2
 *
 * assuming d = 1/(x2 - x1) is given, and inputs aren't zero, and x1 !== x2
 * (edge cases are handled one level higher, before batching)
 *
 * this supports addition with assignment where G3 === G1 (but not G3 === G2)
 * @param {number[]} scratch
 * @param {AffinePoint} G3 (x3, y3)
 * @param {AffinePoint} G1 (x1, y1)
 * @param {AffinePoint} G2 (x2, y2)
 * @param {number} d 1/(x2 - x1)
 */
function addAffineJs([m, tmp], G3, G1, G2, d) {
  let [x1, y1] = affineCoords(G1);
  let [x2, y2] = affineCoords(G2);
  let [x3, y3] = affineCoords(G3);
  setNonZeroAffine(G3);
  // m = (y2 - y1)*d
  subtractPositive(m, y2, y1);
  multiply(m, m, d);
  // x3 = m^2 - x1 - x2
  square(tmp, m);
  subtract(x3, tmp, x1);
  subtract(x3, x3, x2);
  // y3 = (x2 - x3)*m - y2
  subtractPositive(y3, x2, x3);
  multiply(y3, y3, m);
  subtract(y3, y3, y2);
}

function bytesEqual(b1, b2) {
  if (b1.length !== b2.length) return false;
  for (let i = 0; i < b1.length; i++) {
    if (b1[i] !== b2[i]) return false;
  }
  return true;
}
