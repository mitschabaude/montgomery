/**
 * The main MSM implementation, based on batched-affine additions
 */
import { CurveAffine } from "./curve-affine.js";
import { CurveProjective } from "./curve-projective.js";
import { tic, toc } from "./extra/tictoc.js";
import { MsmField } from "./field-msm.js";
import { GlvScalar } from "./scalar-glv.js";
import { broadcastFromMain } from "./threads/global-pool.js";
import { barrier, isMain, log, logMain, range } from "./threads/threads.js";
import { log2 } from "./util.js";

export { createMsm, MsmCurve };

type MsmCurve = {
  Field: MsmField;
  Scalar: GlvScalar;
  CurveAffine: CurveAffine;
  CurveProjective: CurveProjective;
};

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
 * - we use **batch-affine additions** for step 1 (bucket accumulation).
 *   thus, in this step we loop over all buckets, collect pairs of points to add, and then do a batch-addition on all of them.
 *   this is done in multiple passes, until the points of each bucket are summed to a single point, in an implicit binary tree.
 *   (in each pass, empty buckets and buckets with 1 remaining point are skipped;
 *   also, buckets of uneven length have a dangling point at the end, which doesn't belong to a pair and is skipped and included in a later pass)
 * - we also use **batch-affine additions for all of step 2** (bucket reduction).
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
function createMsm({ Field, Scalar, CurveAffine, CurveProjective }: MsmCurve) {
  const {
    copy,
    subtract,
    add,
    isEqual,
    subtractPositive,
    addAffine,
    endomorphism,
    sizeField,
    memoryBytes,
    constants,
    batchInverse,
  } = Field;

  let { decompose, extractBitSlice, sizeField: sizeScalar } = Scalar;
  const scalarBitlength = Scalar.maxBits;

  let {
    sizeAffine,
    doubleAffine,
    isZeroAffine,
    copyAffine,
    setIsNonZeroAffine,
  } = CurveAffine;

  let {
    sizeProjective,
    addAssign: addAssignProjective,
    doubleInPlace: doubleInPlaceProjective,
    copy: copyProjective,
    affineToProjective,
  } = CurveProjective;

  async function msm(
    scalarPtr0: number,
    pointPtr0: number,
    N: number,
    {
      c: c_,
      c0: c0_,
      useSafeAdditions = true,
    }: { c?: number; c0?: number; useSafeAdditions?: boolean } | undefined = {}
  ) {
    let result = Field.global.getPointer(sizeProjective);
    using _g = Field.global.atCurrentOffset;
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
    let params = { N, K, L, c, c0 };
    logMain({ n, K, c, c0 });

    let scratch = Field.local.getPointers(30);

    /**
     * Preparation phase 1
     * --------------------
     *
     * this phase is where we process inputs:
     * - store input points in wasm memory, in the format we need
     * - compute & store negative, endo, and negative-endo points
     * - decompose input scalars as `s = s0 + s1*lambda` and store s0, s1 in wasm memory
     * - walk over the c-bit windows of each scalar, to
     *   - count the number of points for each bucket
     *   - count the total number of pairs to add in the first batch addition
     *
     * note: actual copying into buckets is done in the next phase!
     * here, we just use the scalar slices to count bucket sizes, as first step of a counting sort.
     */
    tic("prepare points & scalars");
    let {
      pointPtr,
      scalarPtr,
      bucketCounts,
      scalarSlices,
      maxBucketSize,
      nPairsMax,
    } = preparePointsAndScalars(pointPtr0, scalarPtr0, params);
    toc();

    /**
     * Preparation phase 2
     * -------------------
     *
     * this phase basically consists of the second and third loops of the _counting sort_ algorithm shown here:
     * https://en.wikipedia.org/wiki/Counting_sort#Pseudocode
     */
    tic("share buckets");
    let buckets: Uint32Array[];
    [bucketCounts, scalarSlices, buckets, maxBucketSize, nPairsMax] =
      await broadcastFromMain("buckets", () => {
        let buckets: Uint32Array[] = Array(K);
        for (let k = 0; k < K; k++) {
          buckets[k] = new Uint32Array(new SharedArrayBuffer(4 * (L + 1)));
          // the starting pointer for the array of points, in bucket order
          buckets[k][0] = Field.global.getPointer(2 * N * sizeAffine);
        }
        return [bucketCounts, scalarSlices, buckets, maxBucketSize, nPairsMax];
      });
    toc();

    tic("integrate bucket counts");
    if (isMain()) {
      integrateBucketCounts(bucketCounts, buckets, params);
    }
    await barrier();
    toc();

    tic("sort points");
    sortPoints(
      buckets,
      pointPtr,
      scalarPtr,
      bucketCounts,
      scalarSlices,
      params
    );
    await barrier();
    toc();

    // first stage - bucket accumulation
    tic("bucket accumulation");
    if (isMain()) console.log();

    let G = new Uint32Array(nPairsMax); // holds first summands
    let H = new Uint32Array(nPairsMax); // holds second summands

    // batch-add buckets into their first point, in `maxBucketSize` iterations
    for (let m = 1; m < maxBucketSize; m *= 2) {
      let p = 0;
      let sizeAffineM = m * sizeAffine;
      let sizeAffine2M = 2 * m * sizeAffine;

      // walk over this thread's buckets to identify point-pairs to add
      for (
        let [i, iend] = range(K * L), k = Math.floor(i / L), l = (i % L) + 1;
        i < iend;
        i++, l === L ? (k++, (l = 1)) : l++
      ) {
        let bucketsK = buckets[k];
        let bucket = bucketsK[l - 1];
        let nextBucket = bucketsK[l];
        for (; bucket + sizeAffineM < nextBucket; bucket += sizeAffine2M) {
          // log("bucket", k, l, "pair", p, "of", nPairs);
          G[p] = bucket;
          H[p] = bucket + sizeAffineM;
          p++;
        }
      }
      let nPairs = p;
      if (nPairs === 0) continue;

      using _ = Field.local.atCurrentOffset;
      let denom = Uint32Array.from(Field.local.getPointers(nPairs, sizeField));
      let tmp = Uint32Array.from(Field.local.getPointers(nPairs, sizeField));

      // now (G,H) represents a big array of independent additions, which we batch-add
      tic();
      if (useSafeAdditions) {
        batchAdd(scratch, tmp, denom, G, G, H, nPairs);
      } else {
        batchAddUnsafe(scratch, tmp[0], denom[0], G, G, H, nPairs);
      }
      let t = toc();
      if (isMain() && t > 0)
        console.log(
          `batch add: ${(t * 1e3).toFixed(0)}ms, ${nPairs} pairs, ${(
            (t / nPairs) *
            1e9
          ).toFixed(1)}ns / pair`
        );
    }
    toc();

    tic("bucket accumulation (wait)");
    await barrier();
    toc();

    // TODO
    if (!isMain()) return 0;
    // we're done!!
    // buckets[k][l-1] now contains the bucket sum (for non-empty buckets)

    // second stage
    tic("normalize bucket storage");
    let buckets2 = normalizeBucketsStorage(buckets, params);
    toc();

    tic("bucket reduction");
    let partialSums = reduceBucketsAffine(scratch, buckets2, params);
    toc();

    // third stage -- compute final sum
    tic("final sum");
    let finalSum = Field.global.getPointer(sizeProjective);
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
    toc();
    return result;
  }

  /**
   * input: points and scalars
   *
   * output:
   * - points in 4 variants: G, -G, endo(G), -endo(G)
   *   with coordinates in Montgomery form
   * - scalars decomposed into 2 half-size chunks
   * - bucket counts
   */
  function preparePointsAndScalars(
    pointPtr0: number,
    scalarPtr0: number,
    { N, K, L, c }: { N: number; K: number; L: number; c: number }
  ) {
    let sizeAffine4 = 4 * sizeAffine;
    let pointPtr = Field.global.getPointer(N * sizeAffine4);
    let sizeScalar2 = 2 * sizeScalar;
    let scalarPtr = Field.global.getPointer(N * sizeScalar2);

    // TODO
    if (!isMain()) {
      return {
        pointPtr,
        scalarPtr,
        bucketCounts: [],
        scalarSlices: [],
        maxBucketSize: 0,
        nPairsMax: 0,
      };
    }

    let bucketCounts: Uint32Array[] = Array(K);
    let scalarSlices: Uint32Array[] = Array(K);
    for (let k = 0; k < K; k++) {
      bucketCounts[k] = new Uint32Array(new SharedArrayBuffer(8 * (L + 1)));
      scalarSlices[k] = new Uint32Array(new SharedArrayBuffer(8 * 2 * N));
    }

    let maxBucketSize = 0;
    let nPairsMax = 0; // we need to allocate space for one pointer per addition pair
    let doubleL = 2 * L;

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
        scalarSlices[k][2 * i] = l | (carry0 << 31);

        if (l !== 0) {
          // if the slice is non-zero, increase bucket count
          let bucketSize = ++bucketCounts[k][l];
          if ((bucketSize & 1) === 0) nPairsMax++;
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
        scalarSlices[k][2 * i + 1] = l | (carry1 << 31);

        if (l !== 0) {
          // if the slice is non-zero, increase bucket count
          let bucketSize = ++bucketCounts[k][l];
          if ((bucketSize & 1) === 0) nPairsMax++;
          if (bucketSize > maxBucketSize) maxBucketSize = bucketSize;
        }
      }
    }
    return {
      pointPtr,
      scalarPtr,
      bucketCounts,
      scalarSlices,
      maxBucketSize,
      nPairsMax,
    };
  }

  function integrateBucketCounts(
    bucketCounts: Uint32Array[],
    buckets: Uint32Array[],
    { K, L }: { K: number; L: number }
  ) {
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
  }

  /**
   * input:\
   * points, scalars and bucket counts returned from {@link preparePointsAndScalars}
   *
   * output:\
   * buckets bounds, which lay out the points sorted in bucket order, for each partition
   */
  function sortPoints(
    buckets: Uint32Array[],
    pointPtr: number,
    scalarPtr: number,
    bucketCounts: Uint32Array[],
    scalarSlices: Uint32Array[],
    { N, K }: { N: number; K: number }
  ) {
    let sizeAffine2 = 2 * sizeAffine;
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
    for (let [k, kend] = range(K); k < kend; k++) {
      let scalarSlicesK = scalarSlices[k];
      let bucketsK = buckets[k];
      let bucketCountsK = bucketCounts[k];
      for (
        // we loop over implicit arrays of points & scalars by taking their starting pointers and incrementing by the size of one element
        // note: this time, we treat `G` and `endo(G)` as separate points, and iterate over 2N points.
        let i = 0, point = pointPtr, scalar = scalarPtr;
        i < 2 * N;
        i++, point += sizeAffine2, scalar += sizeScalar
      ) {
        // a point `A` and it's negation `-A` are stored next to each other
        let negPoint = point + sizeAffine;

        /**
         * recomputing the scalar slices here with {@link extractBitSlice} is faster than storing & retrieving them!
         */
        let l = scalarSlicesK[i];
        let carry = l >>> 31;
        l &= 0x7f_ff_ff_ff;

        if (l === 0) continue;
        // compute the memory address in the bucket array where we want to store our point
        let ptr0 = bucketsK[0];
        let l0 = bucketCountsK[l]++; // update start index, so the next point in this bucket lands at one position higher
        let newPtr = ptr0 + l0 * sizeAffine; // this is where the point should be copied to
        let ptr = carry === 1 ? negPoint : point; // this is the point that should be copied
        // copy point to the bucket array -- expensive operation! (but it pays off)
        copyAffine(newPtr, ptr);
      }
    }
  }

  function normalizeBucketsStorage(
    oldBuckets: Uint32Array[],
    { K, L }: { K: number; L: number }
  ) {
    // normalize the way buckets are stored -- we'll store intermediate running sums there
    // copy bucket sums into new contiguous pointers to improve memory access
    let buckets: Uint32Array[] = Array(K);
    for (let k = 0; k < K; k++) {
      let newBuckets = Uint32Array.from(
        Field.global.getPointers(L + 1, sizeAffine)
      );
      buckets[k] = newBuckets;
      let oldBucketsK = oldBuckets[k];
      let nextBucket = oldBucketsK[0];
      setIsNonZeroAffine(newBuckets[0], false);
      for (let l = 1; l <= L; l++) {
        let bucket = nextBucket;
        nextBucket = oldBucketsK[l];
        if (bucket === nextBucket) {
          // empty bucket
          setIsNonZeroAffine(newBuckets[l], false);
        } else {
          copyAffine(newBuckets[l], bucket);
        }
      }
    }
    return buckets;
  }

  /**
   * reducing buckets into one sum per partition, using only batch-affine additions & doublings
   */
  function reduceBucketsAffine(
    scratch: number[],
    buckets: Uint32Array[],
    { c, c0, K, L }: { c: number; c0: number; K: number; L: number }
  ) {
    // D = 1 is the standard algorithm, just batch-added over the K partitions
    // D > 1 means that we're doing D * K = n adds at a time
    // => more efficient than doing just K at a time, since we amortize the cost of the inversion better
    let depth = c - 1 - c0;
    let D = 2 ** depth;
    let n = D * K;
    let L0 = 2 ** c0; // == L/D

    let runningSums = new Uint32Array(n);
    let nextBuckets = new Uint32Array(n);
    let denom = Uint32Array.from(Field.global.getPointers(K * L, sizeField));
    let tmp = Uint32Array.from(Field.global.getPointers(K * L, sizeField));

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
      batchAdd(scratch, tmp, denom, nextBuckets, nextBuckets, runningSums, n);
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
      batchAdd(scratch, tmp, denom, majorSums, majorSums, minorSums, p);
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
        batchDoubleInPlace(scratch, tmp, denom, minorSums, p);
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
      batchDoubleInPlace(scratch, tmp, denom, majorSums, p);
    }

    // alright! now our buckets precisely fill up the big triangle
    // => sum them all in a big addition tree
    // we always batchAdd a list of pairs into the first element of each pair
    // round 0: (1,2), (3,4), (5,6), ..., (L-1, L);
    //      === (l,l+1) for l=1; l<L; i+=2
    // round 1: (l,l+2) for l=1; l<L; i+=4
    // round j: let m=2^j; (l,l+m) for l=1; l<L; l+=2*m
    // in the last round we want 1 pair (1, 1 + m=2^(c-1)), so we want m < 2**c = L

    let G = new Uint32Array(K * L);
    let H = new Uint32Array(K * L);

    for (let m = 1; m < L; m *= 2) {
      p = 0;
      for (let k = 0; k < K; k++) {
        for (let l = 1; l < L; l += 2 * m, p++) {
          G[p] = buckets[k][l];
          H[p] = buckets[k][l + m];
        }
      }
      batchAdd(scratch, tmp, denom, G, G, H, p);
    }

    // finally, return the output sum of each partition as a projective point
    // TODO
    let partialSums = Field.local.getZeroPointers(K, sizeProjective);
    for (let k = 0; k < K; k++) {
      if (isZeroAffine(buckets[k][1])) continue;
      affineToProjective(partialSums[k], buckets[k][1]);
    }
    return partialSums;
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
    scratch: number[],
    tmp: Uint32Array,
    d: Uint32Array,
    S: Uint32Array,
    G: Uint32Array,
    H: Uint32Array,
    n: number
  ) {
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
    scratch: number[],
    tmp: number,
    d: number,
    S: Uint32Array,
    G: Uint32Array,
    H: Uint32Array,
    n: number
  ) {
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
    scratch: number[],
    tmp: Uint32Array,
    d: Uint32Array,
    G: Uint32Array,
    n: number
  ) {
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

  return {
    msm,
    msmUnsafe: (
      s: number,
      p: number,
      N: number,
      o?: { c?: number; c0?: number }
    ) => msm(s, p, N, { ...o, useSafeAdditions: false }),
    batchAdd,
  };
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
