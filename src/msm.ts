/**
 * The main MSM implementation, based on batched-affine additions
 */
import {
  CurveAffine,
  batchAdd,
  batchAddUnsafe,
  batchDoubleInPlace,
  getSizeAffine,
} from "./curve-affine.js";
import { CurveProjective } from "./curve-projective.js";
import { MsmField } from "./field-msm.js";
import { GlvScalar } from "./scalar-glv.js";
import { log2 } from "./util.js";

export { createMsm, MsmCurve, BigintPoint, BytesPoint };

export { bigintPointsToMemory, bigintScalarsToMemory };

type MsmCurve = {
  Field: MsmField;
  Scalar: GlvScalar;
  Affine: CurveAffine;
  Projective: CurveProjective;
};

type BytesPoint = [xArray: Uint8Array, yArray: Uint8Array, isZero: boolean];
type BigintPoint = { x: bigint; y: bigint; isZero: boolean };

/**
 * MSM (multi-scalar multiplication)
 * ----------------------------------
 *
 * given scalars `s_i` and points `G_i`, `i=0,...N-1`, compute
 *
 * `[s_0] G_0 + ... + [s_(N-1)] G_(N-1)`.
 *
 * broadly, our implementation uses the pippenger algorithm / bucket method, where scalars are sliced
 * into windows of size c, giving rise to K = [b/c] _partitions_ or "sub-MSMs" (where b is the scalar bit length).
 *
 * for each partition k, points `G_i` are sorted into `L = 2^(c-1)` _buckets_ according to the ḱth NAF slice of their scalar `s_i`.
 * in total, we end up with `K*L` buckets, which are indexed by `(k, l)` where `k = 0,...K-1` and `l = 1,...,L`.
 *
 * after sorting the points, computation proceeds in **three main steps:**
 * 1. each bucket is accumulated into a single point, the _bucket sum_ `B_(l,k)`, which is simply the sum of all points in the bucket.
 * 2. the bucket sums of each partition k are reduced into a partition sum `P_k = 1*B_(k, 1) + 2*B_(k, 2) + ... + L*B_(k, L)`.
 * 3. the partition sums are reduced into the final result, `S = P_0 + 2^c*P_1 + ... + 2^(c*(K-1))*P_(K-1)`
 *
 * ### High-level implementation
 *
 * - we use **batch-affine additions** for step 1 (bucket accumulation),
 *   as pioneered by Zac Williamson in Aztec's barretenberg library: https://github.com/AztecProtocol/barretenberg/pull/19.
 *   thus, in this step we loop over all buckets, collect pairs of points to add, and then do a batch-addition on all of them.
 *   this is done in multiple passes, until the points of each bucket are summed to a single point, in an implicit binary tree.
 *   (in each pass, empty buckets and buckets with 1 remaining point are skipped;
 *   also, buckets of uneven length have a dangling point at the end, which doesn't belong to a pair and is skipped and included in a later pass)
 * - as a novelty, we also use **batch-affine additions for all of step 2** (bucket reduction).
 *   we achieve this by splitting up each partition recursively into sub-partitions, which are reduced independently from each other.
 *   this gives us enough independent additions to amortize the cost of the inversion in the batch-add step.
 *   sub-partitions are recombined in a series of comparatively cheap, log-sized steps. for details, see {@link reduceBucketsAffine}.
 * - we switch from an affine to a projective point representation between steps 2 and 3. step 3 is so tiny (< 0.1% of the computation)
 *   that the performance of projective curve arithmetic becomes irrelevant.
 *
 * the algorithm has a significant **preparation phase**, which happens before step 1, where we split scalars and sort points and such.
 * before splitting scalars into length-c slices, we do a **GLV decomposition**, where each 256-bit scalar is split into two
 * 128-bit chunks as `s = s0 + s1*lambda`. multiplying a point by `lambda` is a curve endomorphism,
 * with an efficient implementation `[lambda] (x,y) = (beta*x, y) =: endo((x, y))`,
 * where `lambda` and `beta` are certain cube roots of 1 in their respective fields.
 * correspondingly, each point `G` becomes two points `G`, `endo(G)`.
 * we also store `-G` and `-endo(G)` which are used when the NAF slices of `s0`, `s1` are negative.
 *
 * other than processing inputs, the preparation phase is concerned with organizing points. this should be done in a way which:
 * 1. enables to efficiently collect independent point pairs to add, in multiple successive passes over all buckets;
 * 2. makes memory access efficient when batch-adding pairs => ideally, the 2 points that form a pair, as well as consecutive pairs, are stored next to each other
 *
 * we address these two goals by copying all points to K independent linear arrays; one for each partition.
 * ordering in each of these arrays is achieved by performing a _counting sort_ of all points with respect to their bucket `l` in partition `k`.
 *
 * between step 1 and 2, there is a similar re-organization step. at the end of step 1, bucket sums are accumulated into the `0` locations
 * of each original bucket, which are spread apart as far as the original buckets were long.
 * before step 2, we copy bucket sums to a new linear array from 1 to L, for each partition.
 *
 * finally, here's a rough breakdown of the time spent in the 5 different phases of the algorithm.
 * we split the preparation phase into two; the "summation steps" are the three steps also defined above.
 *
 * ```txt
 *  8% - preparation 1 (input processing)
 * 12% - preparation 2 (sorting points in bucket order)
 * 65% - summation step 1 (bucket accumulation)
 * 15% - summation step 2 (bucket reduction)
 *  0% - summation step 3 (final sum over partitions)
 * ```
 *
 * you can find more details on each phase and reasoning about performance in the comments below!
 *
 * @param scalars pointer to array of scalars `s_0, ..., s_(N-1)`
 * @param points pointer to array of points `G_0, ..., G_(N-1)`
 * @param N number of scalars/points
 * @param options optional msm parameters `c`, `c0` (this is only needed when trying out different parameters
 * than our well-optimized, hard-coded ones; see {@link cTable})
 */
function createMsm({ Field, Scalar, Affine, Projective }: MsmCurve) {
  const {
    multiply,
    copy,
    subtract,
    inverse,
    endomorphism,
    getPointers,
    sizeField,
    memoryBytes,
    getZeroPointers,
    resetPointers,
    constants,
    fromMontgomery,
    getPointer,
    readBigint,
    getPointersInMemory,
    getEmptyPointersInMemory,
  } = Field;

  let {
    decompose,
    extractBitSlice,
    sizeField: sizeScalar,
    resetPointers: resetPointersScalar,
  } = Scalar;
  const scalarBitlength = Scalar.maxBits;

  let { size: sizeAffine, isZero: isZeroAffine, copy: copyAffine } = Affine;

  let {
    size: sizeProjective,
    addAssign: addAssignProjective,
    doubleInPlace: doubleInPlaceProjective,
    isZero: isZeroProjective,
    copy: copyProjective,
    fromAffine: affineToProjective,
    coords: projectiveCoords,
  } = Projective;

  // MSM where input scalars and points are bigints
  function msmBigint(
    inputScalars: bigint[],
    inputPoints: BigintPoint[],
    options:
      | { c?: number; c0?: number; useSafeAdditions?: boolean }
      | undefined = {}
  ) {
    let N = inputPoints.length;
    if (inputScalars.length !== N) {
      throw Error("Mismatch of scalar/point array length");
    }

    // transfer scalars to wasm memory
    let scalarPtr = bigintScalarsToMemory(Scalar, inputScalars);
    // transfer points to wasm memory
    let pointPtr = bigintPointsToMemory(Field, inputPoints);

    let finalSum = msm(scalarPtr, pointPtr, N, options);

    // convert final sum back to affine point
    let result = toAffineOutputBigint(getPointers(4), finalSum);

    resetPointers();
    resetPointersScalar();

    return result;
  }

  function msm(
    scalarPtr0: number,
    pointPtr0: number,
    N: number,
    {
      c: c_,
      c0: c0_,
      useSafeAdditions = true,
    }: { c?: number; c0?: number; useSafeAdditions?: boolean } | undefined = {}
  ) {
    let result = getPointer(sizeProjective);
    let memoryOffset = Field.getOffset();
    let n = log2(N);
    let c = n - 1;
    if (c < 1) c = 1;
    let c0 = c >> 1;
    [c, c0] = cTable[n as keyof typeof cTable] || [c, c0];
    // if parameters for c and c0 were passed in, use those instead
    if (c_) c = c_;
    if (c0_) c0 = c0_;

    let K = Math.ceil((scalarBitlength + 1) / c); // number of partitions
    let L = 2 ** (c - 1); // number of buckets per partition, -1 (we'll skip the 0 bucket, but will have them in the array at index 0 to simplify access)
    let doubleL = 2 * L;

    let sizeAffine2 = 2 * sizeAffine;
    let sizeAffine4 = 4 * sizeAffine;
    let pointPtr = getPointer(N * sizeAffine4);
    let sizeScalar2 = 2 * sizeScalar;
    let scalarPtr = getPointer(N * sizeScalar2);

    let bucketCounts: number[][] = Array(K);
    for (let k = 0; k < K; k++) {
      bucketCounts[k] = Array(L + 1);
      for (let l = 0; l <= L; l++) {
        bucketCounts[k][l] = 0;
      }
    }
    let scratch = getPointers(30);

    let maxBucketSize = 0;
    let nPairs = 0; // we need to allocate space for one pointer per addition pair

    /**
     * Preparation phase 1
     * --------------------
     *
     * this phase is where we process inputs:
     * - store input points in wasm memory, in the format we need
     *   - writing the bytes to wasm memory takes ~2% of total runtime
     *   - we also turn point coordinates x,y to montgomery form;
     *     takes ~1% of runtime (= small potential savings for not using montgomery)
     * - compute & store negative, endo, and negative-endo points
     * - decompose input scalars as `s = s0 + s1*lambda` and store s0, s1 in wasm memory
     * - walk over the c-bit windows of each scalar, to
     *   - count the number of points for each bucket
     *   - count the total number of pairs to add in the first batch addition
     *
     * note: actual copying into buckets is done in the next phase!
     * here, we just use the scalar slices to count bucket sizes, as first step of a counting sort.
     *
     * ### Performance
     *
     * this phase takes ~6% of the total, roughly made up of
     *
     * 1% bucket counts
     * 1% turn coordinates to montgomery form
     * 0.5% endomorphism
     * 0.5% split scalars to slices
     * 0.2% other processing of points (negation, copying)
     * 0.1% GLV-decompose scalar
     *
     * it's hard to get perfect data from the profiler because this phase is a hodgepodge of so many different small pieces.
     * also, there is ~2.7% of unexplained runtime which is spent somewhere in the JS logic.
     * that said, most of the effort here, like writing to wasm memory and processing points, is necessitated
     * by the architecture and can't be significantly reduced.
     */
    for (
      let i = 0,
        point0 = pointPtr0,
        point = pointPtr,
        scalarInput = scalarPtr0,
        scalar = scalarPtr;
      i < N;
      i++,
        point0 += sizeAffine,
        point += sizeAffine4,
        scalarInput += sizeScalar,
        scalar += sizeScalar2
    ) {
      // load scalar and decompose from one 32-byte into two 16-byte chunks
      let scalar0 = scalar;
      let scalar1 = scalar + sizeScalar;
      let negateFlags = decompose(scalar0, scalar1, scalarInput);
      let scalar0Negative = negateFlags & 1;
      let scalar1Negative = negateFlags >> 1;

      let x = point;
      let y = point + sizeField;

      // copy original point to new, larger array
      copy(x, point0);
      copy(y, point0 + sizeField);
      let isNonZero = memoryBytes[point0 + 2 * sizeField];
      memoryBytes[point + 2 * sizeField] = isNonZero;

      // -point, endo(point), -endo(point)
      // this just takes 1 field multiplication for the endomorphism, and 1 subtraction
      let negPoint = point + sizeAffine;
      let endoPoint = negPoint + sizeAffine;
      let negEndoPoint = endoPoint + sizeAffine;
      copy(negPoint, x);

      memoryBytes[negPoint + 2 * sizeField] = isNonZero;
      endomorphism(endoPoint, point);
      memoryBytes[endoPoint + 2 * sizeField] = isNonZero;
      copy(negEndoPoint, endoPoint);
      memoryBytes[negEndoPoint + 2 * sizeField] = isNonZero;

      if (scalar0Negative) {
        copy(negPoint + sizeField, y);
        subtract(y, constants.p, y);
      } else {
        subtract(negPoint + sizeField, constants.p, y);
      }
      if (scalar1Negative === scalar0Negative) {
        copy(endoPoint + sizeField, y);
        copy(negEndoPoint + sizeField, negPoint + sizeField);
      } else {
        copy(negEndoPoint + sizeField, y);
        copy(endoPoint + sizeField, negPoint + sizeField);
      }

      // partition each 16-byte scalar into c-bit slices
      for (let k = 0, carry0 = 0, carry1 = 0; k < K; k++) {
        // compute kth slice from first half scalar
        let l = extractBitSlice(scalar0, k * c, c) + carry0;

        if (l > L) {
          l = doubleL - l;
          carry0 = 1;
        } else {
          carry0 = 0;
        }
        if (l !== 0) {
          // if the slice is non-zero, increase bucket count
          let bucketSize = ++bucketCounts[k][l];
          if ((bucketSize & 1) === 0) nPairs++;
          if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
        }
        // compute kth slice from second half scalar
        // note: we repeat this code instead of merging both into a loop of size 2,
        // because the latter would imply creating a throw-away array of size two for the scalars.
        // creating such throw-away objects has a garbage collection cost
        l = extractBitSlice(scalar1, k * c, c) + carry1;

        if (l > L) {
          l = doubleL - l;
          carry1 = 1;
        } else {
          carry1 = 0;
        }
        if (l !== 0) {
          // if the slice is non-zero, increase bucket count
          let bucketSize = ++bucketCounts[k][l];
          if ((bucketSize & 1) === 0) nPairs++;
          if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
        }
      }
    }
    /**
     * Preparation phase 2
     * -------------------
     *
     * this phase basically consists of the second and third loops of the _counting sort_ algorithm shown here:
     * https://en.wikipedia.org/wiki/Counting_sort#Pseudocode
     *
     * we actually do K of these counting sorts -- one for each partition.
     *
     * note that the first loop in that link -- counting bucket sizes -- was already performed above,
     * and we have the `counts` stored in {@link bucketCounts}.
     *
     * here's how other parts of the linked algorithm correspond to our code:
     * - array `input`: in our case, this is the array of (scalar, point) pairs created in phase 1.
     *   note: when we say "array" here, we mean a range of memory locations which implicitly form an array.
     * - the `key(...)` function for mapping `input` elements to integer "keys":
     *   in our case, this is the function that computes the (kth) scalar slice belonging to each (scalar, point),
     *   i.e. {@link extractBitSlice} which we used above (loop 1) and which is re-executed in loop 3
     * - array `output`: in our case, we have one output array for each k. it's implicitly represented by a starting
     *   pointer which, right below, is stored at `buckets[k][0]`. by incrementing the pointer by the size of an affine point,
     *   we get to the next point.
     *
     * for our purposes, we don't only need sorting -- we also need to keep track of the indices
     * where one bucket ends and the next one begins, to form correct addition pairs.
     * these bucket bounds are stored in {@link buckets}.
     *
     * ## Performance
     *
     * this phase needs ~12% of total runtime (for 2^16 input points).
     *
     * this time is dominated by 8.5% for the {@link copyAffine} invocation at the end of 'loop #3'.
     * it writes to an unpredictable memory location (randomly distributed bucket) in each iteration.
     *
     * unfortunately, copying points scales superlinearly with input size:
     * for 2^18 input points, this phase already takes ~14% of runtime.
     *
     * as far as we can tell, this is still preferable to any other solutions we are aware of.
     * solutions that avoid the copying / sorting step seem to incur plenty of time for both random reads and
     * random writes during the bucket accumulation step, and end up being much slower -- especially or large inputs.
     * the counting sort solution almost entirely avoids random reads, with the exception of
     * reading random buckets from the relatively small {@link bucketCounts} helper array.
     *
     * there is not much other stuff happening in this phase:
     * - 'loop #2' is negligible at < 0.1% of runtime.
     * - 1-2% spent on {@link bucketCounts} reads/writes
     * - 0.5% on {@link extractBitSlice}
     */
    let buckets: number[][] = Array(K);
    for (let k = 0; k < K; k++) {
      buckets[k] = Array(L + 1);
      // the starting pointer for the array of points, in bucket order
      buckets[k][0] = getPointer(2 * N * sizeAffine);
    }
    /**
     * loop #2 of counting sort (for each k).
     * "integrate" bucket counts, to become start / end indices (i.e., bucket bounds).
     * while we're at it, we fill an array `buckets` with the same bucket bounds but in a
     * more convenient format -- as memory addresses.
     */
    for (let k = 0; k < K; k++) {
      let counts = bucketCounts[k];
      let running = 0;
      let bucketsK = buckets[k];
      let runningIndex = bucketsK[0];
      for (let l = 1; l <= L; l++) {
        let count = counts[l];
        counts[l] = running;
        running += count;
        runningIndex += count * sizeAffine;
        bucketsK[l] = runningIndex;
      }
    }
    /**
     * loop #3 of counting sort (for each k).
     * we loop over the input elements and re-compute in which bucket `l` they belong.
     * by retrieving counts[l], we find the output position where a point should be stored in.
     * at the beginning, counts[l] will be the 0 index of bucket l, but when we store a point we increment count[l]
     * so that the next point in this bucket is stored at the next position.
     *
     * all in all, the result of this sorting is that points form a contiguous array, one bucket after another
     * => this is fantastic for the batch additions in the next step
     */
    for (
      // we loop over implicit arrays of points & scalars by taking their starting pointers and incrementing by the size of one element
      // note: this time, we treat `G` and `endo(G)` as separate points, and iterate over 2N points.
      let i = 0, point = pointPtr, scalar = scalarPtr;
      i < 2 * N;
      i++, point += sizeAffine2, scalar += sizeScalar
    ) {
      // a point `A` and it's negation `-A` are stored next to each other
      let negPoint = point + sizeAffine;
      let carry = 0;
      /**
       * recomputing the scalar slices here with {@link extractBitSlice} is faster than storing & retrieving them!
       */
      for (let k = 0; k < K; k++) {
        let l = extractBitSlice(scalar, k * c, c) + carry;
        if (l > L) {
          l = doubleL - l;
          carry = 1;
        } else {
          carry = 0;
        }
        if (l === 0) continue;
        // compute the memory address in the bucket array where we want to store our point
        let ptr0 = buckets[k][0];
        let l0 = bucketCounts[k][l]++; // update start index, so the next point in this bucket lands at one position higher
        let newPtr = ptr0 + l0 * sizeAffine; // this is where the point should be copied to
        let ptr = carry === 1 ? negPoint : point; // this is the point that should be copied
        // copy point to the bucket array -- expensive operation! (but it pays off)
        copyAffine(newPtr, ptr);
      }
    }

    let [G, gPtr] = getEmptyPointersInMemory(nPairs); // holds first summands
    let [H, hPtr] = getEmptyPointersInMemory(nPairs); // holds second summands
    // let denom = getPointer(nPairs * sizeField);
    // let tmp = getPointer(nPairs * sizeField);
    let [denom] = getPointersInMemory(nPairs, sizeField);
    let [tmp] = getPointersInMemory(nPairs, sizeField);

    // batch-add buckets into their first point, in `maxBucketSize` iterations
    for (let m = 1; m < maxBucketSize; m *= 2) {
      let p = 0;
      let sizeAffineM = m * sizeAffine;
      let sizeAffine2M = 2 * m * sizeAffine;
      // walk over all buckets to identify point-pairs to add
      for (let k = 0; k < K; k++) {
        let bucketsK = buckets[k];
        let nextBucket = bucketsK[0];
        for (let l = 1; l <= L; l++) {
          let point = nextBucket;
          nextBucket = bucketsK[l];
          for (; point + sizeAffineM < nextBucket; point += sizeAffine2M) {
            G[p] = point;
            H[p] = point + sizeAffineM;
            p++;
          }
        }
      }
      nPairs = p;
      // now (G,H) represents a big array of independent additions, which we batch-add
      if (useSafeAdditions) {
        batchAdd(Field, Affine, scratch, tmp, denom, G, G, H, nPairs);
      } else {
        batchAddUnsafe(Field, scratch, tmp[0], denom[0], G, G, H, nPairs);
        // wasm version has indistinguishable performance
        // Field.batchAddUnsafe(scratch[0], tmp[0], denom[0], gPtr, gPtr, hPtr, nPairs);
      }
    }
    // we're done!!
    // buckets[k][l-1] now contains the bucket sum (for non-empty buckets)

    // second stage
    let partialSums = reduceBucketsAffine(scratch, buckets, { c, c0, K, L });

    // third stage -- compute final sum
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
    copyProjective(result, finalSum);
    Field.setOffset(memoryOffset);
    return result;
  }

  /**
   * reducing buckets into one sum per partition, using only batch-affine additions & doublings
   *
   * @param {number[]} scratch
   * @param {number[][]} oldBuckets
   * @param {{c: number, c0: number, K: number, L: number}} options
   */
  function reduceBucketsAffine(
    scratch: number[],
    oldBuckets: number[][],
    { c, c0, K, L }: { c: number; c0: number; K: number; L: number }
  ) {
    // D = 1 is the standard algorithm, just batch-added over the K partitions
    // D > 1 means that we're doing D * K = n adds at a time
    // => more efficient than doing just K at a time, since we amortize the cost of the inversion better
    let depth = c - 1 - c0;
    let D = 2 ** depth;
    let n = D * K;
    let L0 = 2 ** c0; // == L/D

    // normalize the way buckets are stored -- we'll store intermediate running sums there
    // copy bucket sums into new contiguous pointers to improve memory access
    let buckets: number[][] = Array(K);
    for (let k = 0; k < K; k++) {
      let newBuckets = getZeroPointers(L + 1, sizeAffine);
      buckets[k] = newBuckets;
      let oldBucketsK = oldBuckets[k];
      let nextBucket = oldBucketsK[0];
      for (let l = 1; l <= L; l++) {
        let bucket = nextBucket;
        nextBucket = oldBucketsK[l];
        if (bucket === nextBucket) continue;
        let newBucket = newBuckets[l];
        copyAffine(newBucket, bucket);
      }
    }

    let [runningSums] = getEmptyPointersInMemory(n);
    let [nextBuckets] = getEmptyPointersInMemory(n);
    let [d] = getPointersInMemory(K * L, sizeField);
    let [tmp] = getPointersInMemory(K * L, sizeField);

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
      // add them; we add-assign the running sum to the next bucket and not the other way;
      // building up a list of intermediary partial sums at the pointers that were the buckets before
      batchAdd(
        Field,
        Affine,
        scratch,
        tmp,
        d,
        nextBuckets,
        nextBuckets,
        runningSums,
        n
      );
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
      batchAdd(
        Field,
        Affine,
        scratch,
        tmp,
        d,
        majorSums,
        majorSums,
        minorSums,
        p
      );
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
    if (D > 1) {
      for (let j = 0; j < c0; j++) {
        batchDoubleInPlace(Field, Affine, scratch, tmp, d, minorSums, p);
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
      batchDoubleInPlace(Field, Affine, scratch, tmp, d, majorSums, p);
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
      batchAdd(Field, Affine, scratch, tmp, d, G, G, H, p);
    }

    // finally, return the output sum of each partition as a projective point
    let partialSums = getZeroPointers(K, sizeProjective);
    for (let k = 0; k < K; k++) {
      if (isZeroAffine(buckets[k][1])) continue;
      affineToProjective(partialSums[k], buckets[k][1]);
    }
    return partialSums;
  }

  /**
   * converts projective point back to affine, and into the `InputPoint` format expected from the MSM
   *
   * @param {number[]} scratch toAffineOutputBigint
   * @param {number} point projective representation
   * @returns {InputPoint}
   */
  function toAffineOutputBigint(
    [zinv, ...scratch]: number[],
    point: number
  ): BigintPoint {
    if (isZeroProjective(point)) {
      return { x: 0n, y: 0n, isZero: true };
    }
    let [x, y, z] = projectiveCoords(point);
    // return x/z, y/z
    inverse(scratch[0], zinv, z);
    multiply(x, x, zinv);
    multiply(y, y, zinv);
    fromMontgomery(x);
    fromMontgomery(y);
    return { x: readBigint(x), y: readBigint(y), isZero: false };
  }

  return {
    msm,
    msmUnsafe: (
      s: number,
      p: number,
      N: number,
      o?: { c?: number; c0?: number }
    ) => msm(s, p, N, { ...o, useSafeAdditions: false }),
    msmBigint,
    batchAdd,
    toAffineOutputBigint,
  };
}

function bigintPointsToMemory(
  { getPointer, sizeField, writeBigint, memoryBytes, toMontgomery }: MsmField,
  inputPoints: BigintPoint[]
) {
  let N = inputPoints.length;
  let sizeAffine = getSizeAffine(sizeField);
  let pointPtr = getPointer(N * sizeAffine);

  for (let i = 0, point = pointPtr; i < N; i++, point += sizeAffine) {
    let inputPoint = inputPoints[i];
    /**
     * store point in n-limb format and convert to montgomery representation.
     * see {@link sizeField} for the memory layout.
     */
    let x = point;
    let y = point + sizeField;
    writeBigint(x, inputPoint.x);
    writeBigint(y, inputPoint.y);
    let isNonZero = Number(!inputPoint.isZero);
    memoryBytes[point + 2 * sizeField] = isNonZero;

    // do one multiplication on each coordinate to bring it into montgomery form
    toMontgomery(x);
    toMontgomery(y);
  }
  return pointPtr;
}

function bigintScalarsToMemory(
  { sizeField: sizeScalar, getPointer, writeBigint }: GlvScalar,
  inputScalars: bigint[]
) {
  let N = inputScalars.length;
  let scalarPtr = getPointer(N * sizeScalar);
  for (let i = 0, scalar = scalarPtr; i < N; i++, scalar += sizeScalar) {
    let inputScalar = inputScalars[i];
    writeBigint(scalar, inputScalar);
  }
  return scalarPtr;
}

/**
 * table of the form `n: (c, c0)`, which has msm parameters c, c0 for different n.
 * n is the log-size of scalar and point inputs.
 * table was optimized with pasta curves
 *
 * @param c window size
 * @param c0 log-size of sub-partitions used in the bucket reduction step
 */
const cTable: Record<number, [c: number, c0: number] | undefined> = {
  14: [13, 7],
  15: [13, 7],
  16: [14, 8],
  17: [16, 8],
  18: [16, 8],
};
