import {
  getPointers,
  inverse,
  square,
  n,
  memoryBytes,
  getZeroPointers,
  writeBytes,
  toMontgomery,
  resetPointers,
  constants,
  readBigInt,
  fromMontgomery,
} from "./finite-field.js";
import {
  multiply,
  copy,
  subtract,
  resetMultiplyCount,
  multiplyCount,
  add,
  isEqual,
} from "./finite-field.wat.js";
import { extractBitSlice, log2 } from "./util.js";

export { msmAffine, batchAddAssign, batchInverseInPlace };

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

let numberOfAdds = 0;
let numberOfDoubles = 0;

/**
 *
 * @param {CompatibleScalar[]} scalars
 * @param {CompatiblePoint[]} inputPoints
 */
function msmAffine(scalars, inputPoints) {
  // initialize buckets
  let N = scalars.length;

  let c = log2(N) - 3; // TODO: determine c from n and hand-optimized lookup table
  if (c < 1) c = 1;
  // TODO: do less computations for last, smaller chunk of scalar
  let K = Math.ceil(256 / c); // number of partitions
  let L = 2 ** c; // number of buckets per partition, +1 (we'll skip the 0 bucket, but will have them in the array at index 0 to simplify access)
  let points = getPointers(N, sizeAffine); // initialize points

  // a bucket is an array of pointers that will gradually get accumulated into the first element
  // initialize a L*K matrix of buckets
  /**
   * @type {(number | undefined)[][][]}
   */
  let buckets = Array(K);
  for (let k = 0; k < K; k++) {
    buckets[k] = Array(L);
    for (let l = 0; l < L; l++) {
      // TODO figure out most efficient initialization
      buckets[k][l] = [];
    }
  }
  let scratchSpace = getPointers(20);

  let maxBucketSize = 0;
  let nPairs = 0; // we need to allocate space for one pointer per addition pair

  resetMultiplyCount();
  numberOfAdds = 0;
  numberOfDoubles = 0;

  // zeroth stage
  // convert points into our format and organize them into buckets, without additions
  for (let i = 0; i < N; i++) {
    let scalar = scalars[i];
    let inputPoint = inputPoints[i];
    let point = points[i];
    // convert point to montgomery
    let x = point;
    let y = point + sizeField;
    memoryBytes[point + 2 * sizeField] = Number(!inputPoint[2]);
    writeBytes(scratchSpace, x, inputPoint[0]);
    writeBytes(scratchSpace, y, inputPoint[1]);
    toMontgomery(x);
    toMontgomery(y);

    // partition 32-byte scalar into c-bit chunks
    for (let k = 0; k < K; k++) {
      // compute k-th digit from scalar
      let l = extractBitSlice(scalar, k * c, c);
      if (l === 0) continue;
      // add point to bucket
      let bucket = buckets[k][l];
      bucket.push(point);
      let bucketSize = bucket.length;
      if ((bucketSize & 1) === 0) nPairs++;
      if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
    }
  }
  /**
   * @type {number[]}
   */
  let G = Array(nPairs); // holds first summands
  /**
   * @type {number[]}
   */
  let H = Array(nPairs); // holds second summands
  let P = getPointers(nPairs, sizeAffine); // holds sums
  let denominators = getPointers(nPairs);
  let tmp = getPointers(nPairs);

  // first stage
  // batch-add buckets into their first point, in `maxBucketSize` iterations

  // first iteration -- a bit different than the others, because we use a third point as the addition result
  let m = 1;
  // only do this if there are any pairs...
  if (m < maxBucketSize) {
    let p = 0;
    // walk over all buckets to identify point-pairs to add
    for (let k = 0; k < K; k++) {
      for (let l = 1; l < L; l++) {
        let x = buckets[k][l];
        let bucketSize = x.length;
        for (let i = 0; i + 1 < bucketSize; i += 2) {
          G[p] = x[i];
          H[p] = x[i + 1];
          x[i] = P[p]; // the point where the pair is summed into replaces x[i] in the bucket
          p++;
        }
      }
    }
    // now (P,G,H) represents a big array of independent additions, which we batch-add
    // TODO: here, we need to handle the x1 === x2 case, in which case (x2 - x1) shouldn't be part of batch inversion
    // => batch affine doubling into P[p] for the y1 === x2 cases, keeping P[p] zero for y1 === -y2
    batchAdd(scratchSpace, tmp, denominators, P, G, H, nPairs);
  }
  // now let's repeat until we summed all buckets into one element
  for (m *= 2; m < maxBucketSize; m *= 2) {
    let p = 0;
    // walk over all buckets to identify point-pairs to add
    for (let k = 0; k < K; k++) {
      for (let l = 1; l < L; l++) {
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
    batchAddAssign(scratchSpace, tmp, denominators, G, H, nPairs);
  }
  // we're done!!
  // buckets[k][l][0] now contains the bucket sum, or undefined for empty buckets

  let nMul1 = multiplyCount.valueOf();
  resetMultiplyCount();

  // second stage
  let partialSums = reduceBucketsSimple(scratchSpace, buckets, { c, K, L });

  let nMul2 = multiplyCount.valueOf();
  resetMultiplyCount();

  // third stage -- compute final sum using horner's rule
  let [finalSum] = getPointers(1, sizeProjective);
  let k = K - 1;
  let partialSum = partialSums[k];
  copyProjective(finalSum, partialSum);
  k--;
  for (; k >= 0; k--) {
    for (let j = 0; j < c; j++) {
      doubleInPlaceProjective(scratchSpace, finalSum);
    }
    let partialSum = partialSums[k];
    addAssignProjective(scratchSpace, finalSum, partialSum);
  }

  let nMul3 = multiplyCount.valueOf();
  resetMultiplyCount();

  let [x, y, z] = toProjectiveOutput(finalSum);

  // TODO read out and return result
  resetPointers();

  return { nMul1, nMul2, nMul3, x, y, z, numberOfAdds, numberOfDoubles };
}

/**
 * @param {number[]} scratchSpace
 * @param {number[][][]} buckets
 * @param {{c: number, K: number, L: number}}
 */
function reduceBucketsSimple(scratchSpace, buckets, { c, K, L }) {
  /**
   * @type {number[][]}
   */
  let bucketSums = Array(K);
  for (let k = 0; k < K; k++) {
    bucketSums[k] = getPointers(L, sizeProjective);
  }
  let runningSums = getZeroPointers(K, sizeProjective);
  let partialSums = getZeroPointers(K, sizeProjective);

  // sum up buckets to partial sums
  for (let l = L - 1; l > 0; l--) {
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
 * @param {number[]} scratch
 * @param {number[][][]} oldBuckets
 * @param {{c: number, K: number, L: number}}
 */
function reduceBucketsAllAffine(scratch, oldBuckets, { c, K, L }) {
  let depth = 2;
  let D = 2 ** depth;
  let n = D * K;
  let L0 = 2 ** (c - depth); // == L/D
  console.log(`doing ${D} * ${K} = ${n} adds at a time`);

  let d = getPointers(n, sizeAffine);
  let tmp = getPointers(n, sizeAffine);

  // normalize the way buckets are stored -- we'll also store intermediate running sums there
  /** @type {number[][]} */
  let buckets = Array(K);
  for (let k = 0, i = 0; k < K; k++) {
    buckets[k] = Array(L);
    for (let l = 1; l < L; l++, i++) {
      buckets[k][l] = oldBuckets[k][l][0] ?? getPointers(1, sizeAffine);
    }
  }

  /** @type {number[]} */
  let runningSums = Array(n);

  /** @type {number[]} */
  let nextSummands = Array(n);

  for (let k = 0, i = 0; k < K; k++) {
    for (let d = 0; d < D; d++, i++) {
      runningSums[i] = buckets[k][d * L0 + L0 - 1];
    }
  }

  for (let l = L0 - 2; l > 0; l--) {
    // collect buckets to add into running sums
    for (let k = 0, i = 0; k < K; k++) {
      for (let d = 0; d < D; d++, i++) {
        nextSummands[i] = buckets[k][d * L0 + l];
      }
    }
    // add them
    batchAddAssign(scratch, tmp, d, nextSummands, runningSums, n);
    runningSums = nextSummands;
  }
}

/**
 * Given points G0,...,G(n-1) and H0,...,H(n-1), compute
 *
 * Si = Gi + Hi, i=0,...,n-1
 *
 * assuming all the Gi, Hi are non-zero
 *
 * @param {number[]} scratch
 * @param {number[]} tmp pointers of length n
 * @param {number[]} d pointers of length n
 * @param {AffinePoint[]} S
 * @param {AffinePoint[]} G
 * @param {AffinePoint[]} H
 * @param {number} n
 */
function batchAdd(scratch, tmp, d, S, G, H, n) {
  // TODO: here, we need to handle the x1 === x2 case, in which case (x2 - x1) shouldn't be part of batch inversion
  // => batch affine doubling into P[p] for the y1 === x2 cases, keeping P[p] zero for y1 === -y2

  // d[i] = H[i].x - G[i].x
  for (let i = 0; i < n; i++) {
    subtract(d[i], H[i], G[i]);
  }
  batchInverseInPlace(scratch, tmp, d, n);
  for (let i = 0; i < n; i++) {
    addAffine(scratch, S[i], G[i], H[i], d[i]);
  }
}

/**
 * Given points G0,...,G(n-1) and H0,...,H(n-1), compute
 *
 * Gi = Gi + Hi, i=0,...,n-1
 *
 * assuming all the Gi, Hi are non-zero
 *
 * @param {number[]} scratch
 * @param {number[]} tmp pointers of length n
 * @param {number[]} d pointers of length n
 * @param {AffinePoint[]} G
 * @param {AffinePoint[]} H
 * @param {number} n
 */
function batchAddAssign(scratch, tmp, d, G, H, n) {
  // maybe every curve point should have space for one extra field element so we have those tmp pointers ready?

  // check G, H for zero
  let G1 = Array(n);
  let H1 = Array(n);
  let n1 = 0;
  for (let i = 0; i < n; i++) {
    if (isZeroAffine(G[i])) {
      copyAffine(G[i], H[i]);
      continue;
    }
    if (isZeroAffine(H[i])) {
      continue;
    }
    G1[n1] = G[i];
    H1[n1] = H[i];
    // TODO: here, we need to handle the x1 === x2 case, in which case (x2 - x1) shouldn't be part of batch inversion
    // => batch affine doubling into G[p] for the y1 === x2 cases, setting G[p] zero for y1 === -y2
    subtract(d[n1], H1[n1], G1[n1]);
    n1++;
  }
  batchInverseInPlace(scratch, tmp, d, n1);
  for (let i = 0; i < n1; i++) {
    addAssignAffine(scratch, G1[i], H1[i], d[i]);
  }
}

/**
 * affine EC addition, G3 = G1 + G2
 * assuming d = 1/(x2 - x1) is given, and inputs aren't zero, and x1 !== x2 (=> no edge cases)
 * @param {number[]} scratch
 * @param {AffinePoint} G3 (x3, y3)
 * @param {AffinePoint} G1 (x1, y1)
 * @param {AffinePoint} G2 (x2, y2)
 * @param {number} d 1/(x2 - x1)
 */
function addAffine([m], G3, G1, G2, d) {
  numberOfAdds++;
  let [x3, y3] = affineCoords(G3);
  let [x1, y1] = affineCoords(G1);
  let [x2, y2] = affineCoords(G2);
  setNonZeroAffine(G3);
  // m = (y2 - y1)*d
  subtract(m, y2, y1);
  multiply(m, m, d);
  // x3 = m^2 - x1 - x2
  square(x3, m);
  subtract(x3, x3, x1);
  subtract(x3, x3, x2);
  // y3 = (x2 - x3)*m - y2
  subtract(y3, x2, x3);
  multiply(y3, y3, m);
  subtract(y3, y3, y2);
}

/**
 * affine EC addition with assignment, G1 = G1 + G2
 * assuming d = 1/(x2 - x1) is given, and inputs aren't zero, and x1 !== x2
 * @param {number[]} scratch
 * @param {AffinePoint} G1 (x1, y1)
 * @param {AffinePoint} G2 (x2, y2)
 * @param {number} d 1/(x2 - x1)
 */
function addAssignAffine([m, tmp], G1, G2, d) {
  numberOfAdds++;
  let [x1, y1] = affineCoords(G1);
  let [x2, y2] = affineCoords(G2);
  // m = (y2 - y1)*d
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
 * @param {number[]} scratch
 * @param {number[]} tmpX tmp pointers of at least length n
 * @param {number[]} X points to invert, at least length n
 * @param {number} n length
 */
function batchInverseInPlace([invProd, ...scratch], tmpX, X, n) {
  // TODO: this can be made faster and cleaner by merging the 2nd and 3rd loop
  if (n === 0) return;
  if (n === 1) {
    inverse(scratch, invProd, X[0]);
    copy(X[0], invProd);
    return;
  }
  // tmpX = [x0, x0*x1, ..., x0*....*x(n-2), x0*....*x(n-1)]
  // tmpX[i] = x0*...*xi
  copy(tmpX[0], X[0]);
  for (let i = 1; i < n; i++) {
    multiply(tmpX[i], tmpX[i - 1], X[i]);
  }
  // X[0] = 1/(x0*....*x(n-1)) = 1/tmpX[n-1]
  inverse(scratch, invProd, tmpX[n - 1]);

  // X = [garbage, 1/x0, 1/(x0*x1), ..., 1/(x0*....*x(n-2))] (X[i] = 1/(x0*...*x(i-1)))
  // by X[n-1] = invProd * X[n-1], X[i] = X[i+1] * X[i], i >= 1
  // (x0 is not needed for this computation)
  multiply(X[n - 1], invProd, X[n - 1]);
  for (let i = n - 2; i >= 1; i--) {
    multiply(X[i], X[i + 1], X[i]);
  }
  // X = [1/x0, 1/x1, ..., 1/(x(n-1))]
  // by X[0] = X[1],
  // X[i] = 1/xi = (x0*...*x(i-1)) / (x0*...*x(i-1)*xi) = tmpX[i-1] * X[i+1], 1 <= i <= n-2
  // X[n-1] = tmpX[n-2] * invProd
  copy(X[0], X[1]);
  for (let i = 1; i < n - 1; i++) {
    multiply(X[i], tmpX[i - 1], X[i + 1]);
  }
  multiply(X[n - 1], tmpX[n - 2], invProd);
}

/**
 * p1 += p2
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
  numberOfAdds++;
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
  numberOfDoubles++;
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
 * @param {number[]} scratchSpace
 * @param {ProjectivePoint} point projective representation
 */
function toAffineOutput([zinv, ...scratchSpace], P) {
  let [x, y, z] = projectiveCoords(P);
  // return x/z, y/z
  inverse(scratchSpace, zinv, z);
  multiply(x, x, zinv);
  multiply(y, y, zinv);
  fromMontgomery(x);
  fromMontgomery(y);
  return [readBigInt(x), readBigInt(y)];
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

function readAffine(P) {
  let isZero = isZeroAffine(P);
  let [x, y] = affineCoords(P);
  return {
    x: readBigInt(x),
    y: readBigInt(y),
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
