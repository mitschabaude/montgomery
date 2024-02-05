/**
 * The main MSM implementation, based on batched-affine additions
 */
import { CurveAffine, batchAdd, batchAddUnsafe } from "./curve-affine.js";
import { CurveProjective } from "./curve-projective.js";
import { MsmField } from "./field-msm.js";
import { GlvScalar } from "./scalar-glv.js";
import { broadcastFromMain } from "./threads/global-pool.js";
import { THREADS, barrier, isMain, range, thread } from "./threads/threads.js";
import { log2 } from "./util.js";

export { createMsm, MsmCurve };

const REMOVE_ALL_LOGS = false;

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
 */
function createMsm({ Field, Scalar, CurveAffine, CurveProjective }: MsmCurve) {
  const { copy, subtract, endomorphism, sizeField, memoryBytes, constants } =
    Field;
  let { decompose, extractBitSlice, sizeField: sizeScalar } = Scalar;
  const scalarBitlength = Scalar.maxBits;

  let sizeAffine = CurveAffine.size;
  let sizeProjective = CurveProjective.size;

  /**
   *
   * @param scalarPtr0 pointer to array of scalars `s_0, ..., s_(N-1)`
   * @param pointPtr0 pointer to array of points `G_0, ..., G_(N-1)`
   * @param N number of scalars/points
   * @param verboseTiming whether to log timing information
   * @param options optional msm parameters `c`, `c0` (this is only needed when trying out different parameters
   * than our well-optimized, hard-coded ones; see {@link cTable})
   */
  async function msm(
    scalarPtr0: number,
    pointPtr0: number,
    N: number,
    verboseTiming = false,
    {
      c: c_,
      c0: c0_,
      useSafeAdditions = true,
    }:
      | {
          c?: number;
          c0?: number;
          useSafeAdditions?: boolean;
        }
      | undefined = {}
  ) {
    let { tic, toc, log, getLog } = createLog(verboseTiming && isMain());
    tic("msm total");

    let result = Field.global.getPointer(sizeProjective);
    using _g = Field.global.atCurrentOffset;
    using _l = Field.local.atCurrentOffset;
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
    log({ n, K, c, c0 });

    let scratch = Field.local.getPointers(40);

    tic("prepare shared pointers");
    let { bucketCounts, scalarSlices, buckets, maxBucketSizes } =
      await broadcastFromMain("buckets", () => {
        let buckets: Uint32Array[] = Array(K);
        for (let k = 0; k < K; k++) {
          buckets[k] = new Uint32Array(new SharedArrayBuffer(4 * (L + 1)));
          // the starting pointer for the array of points, in bucket order
          buckets[k][0] = Field.global.getPointer(2 * N * sizeAffine);
        }

        let bucketCounts: Uint32Array[] = Array(K);
        let scalarSlices: Uint32Array[] = Array(K);
        for (let k = 0; k < K; k++) {
          bucketCounts[k] = new Uint32Array(new SharedArrayBuffer(8 * (L + 1)));
          scalarSlices[k] = new Uint32Array(new SharedArrayBuffer(8 * 2 * N));
        }

        let maxBucketSizes = new Uint32Array(
          new SharedArrayBuffer(4 * THREADS)
        );
        return { bucketCounts, scalarSlices, buckets, maxBucketSizes };
      });

    // ensure same pointer offsets in other threads
    if (!isMain()) {
      Field.global.getPointer(2 * N * K * sizeAffine);
    }

    // compute chunks of buckets that each thread will work on
    let { chunksPerThread, nChunksPerPartition } = computeBucketsSplit(K, L);

    // allocate space for different threads' contribution to each partitions
    let columnss: Uint32Array[] = Array(K);
    for (let k = 0; k < K; k++) {
      let nChunks = nChunksPerPartition[k];
      columnss[k] = new Uint32Array(nChunks);
      let chunkPtrs = Field.global.getPointers(nChunks, sizeProjective);
      for (let j = 0; j < nChunks; j++) {
        columnss[k][j] = chunkPtrs[j];
        if (isMain()) CurveProjective.setZero(columnss[k][j]);
      }
    }
    toc();

    /**
     * Preparation phase 1
     * --------------------
     *
     * this phase is where we process inputs:
     *
     * - store input points in wasm memory, in the format we need
     * - compute & store negative, endo, and negative-endo points
     * - decompose input scalars as `s = s0 + s1*lambda` and store s0, s1 in wasm memory
     */
    tic("prepare points & scalars");
    let { pointPtr, scalarPtr } = preparePointsAndScalars(
      pointPtr0,
      scalarPtr0,
      params
    );
    toc();

    /**
     * Preparation phase 2
     * -------------------
     *
     * in this phase, we sort points into buckets, and re-organize them into linear arrays.
     *
     * - compute c-bit windows for each scalar
     * - perform a _counting sort_ algorithm as shown here:
     *   https://en.wikipedia.org/wiki/Counting_sort#Pseudocode
     */
    tic("slice scalars & count buckets");
    let maxBucketSizeLocal = 0;

    let twoL = 2 * L;
    let [iHalf, iendHalf] = range(N);

    for (
      let i = iHalf * 2,
        iend = iendHalf * 2,
        scalar = scalarPtr + sizeScalar * i;
      i < iend;
      i++, scalar += sizeScalar
    ) {
      // partition each 16-byte scalar into c-bit slices
      for (let k = 0, carry = 0; k < K; k++) {
        // compute kth slice from first half scalar
        let l = extractBitSlice(scalar, k * c, c) + carry;

        if (l > L) {
          l = twoL - l;
          carry = 1;
        } else {
          carry = 0;
        }
        scalarSlices[k][i] = l | (carry << 31);

        if (l !== 0) {
          // if the slice is non-zero, increase bucket count
          let bucketSize = Atomics.add(bucketCounts[k], l, 1) + 1;
          if (bucketSize > maxBucketSizeLocal) {
            maxBucketSizeLocal = bucketSize;
          }
        }
      }
    }
    maxBucketSizes[thread] = maxBucketSizeLocal;
    toc();

    tic("bucket counts (wait)");
    await barrier();
    let maxBucketSize = Math.max(...maxBucketSizes);
    toc();

    tic("integrate bucket counts");
    // this takes < 1ms, so we do just it on the main thread
    if (isMain()) {
      integrateBucketCounts(bucketCounts, buckets, params);
    }
    await barrier();
    toc();

    tic("sort points");
    sortPoints(buckets, pointPtr, bucketCounts, scalarSlices, params);
    toc();

    tic("sort points (wait)");
    await barrier();
    toc();

    // first stage - bucket accumulation
    tic("bucket accumulation");
    let nPairsMax = N * K; // maximum number of pairs = half the number of points, times K partitions
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
        batchAdd(Field, CurveAffine, scratch, tmp, denom, G, G, H, nPairs);
      } else {
        batchAddUnsafe(Field, scratch, tmp[0], denom[0], G, G, H, nPairs);
      }
      let t = toc();
      if (t > 0)
        log(
          `batch add: ${t.toFixed(0)}ms, ${nPairs} pairs, ${(
            (t / nPairs) *
            1e6
          ).toFixed(1)}ns / pair`
        );
    }
    toc();
    // we're done!!
    // buckets[k][l-1] now contains the bucket sum (for non-empty buckets)

    // second stage
    tic("normalize bucket storage");
    let chunks = normalizeBucketsStorage(
      buckets,
      chunksPerThread[thread],
      true
    );
    toc();

    tic("bucket reduction (local)");
    for (let { j, k, lstart, buckets } of chunks) {
      reduceBucketsColumnProjective(columnss[k][j], buckets, lstart);
    }
    toc();

    tic("bucket accumulation (wait)");
    await barrier();
    toc();

    if (!isMain()) return { result, log: getLog() };

    // third stage -- aggregate contributions from all threads into partition sums,
    // and reduce partition sums into the final result
    // this whole stage takes < 0.2ms and is done on the main thread
    tic("partition sum");
    for (let k = 0; k < K; k++) {
      let columns = columnss[k];
      let partitionSum = columns[0];
      for (let j = 1, n = columns.length; j < n; j++) {
        CurveProjective.addAssign(scratch, partitionSum, columns[j]);
      }
    }
    let partialSums = columnss.map((column) => column[0]);
    toc();

    tic("final sum");
    let finalSum = Field.global.getPointer(sizeProjective);
    let k = K - 1;
    CurveProjective.copy(finalSum, partialSums[k]);
    k--;
    for (; k >= 0; k--) {
      for (let j = 0; j < c; j++) {
        CurveProjective.doubleInPlace(scratch, finalSum);
      }
      CurveProjective.addAssign(scratch, finalSum, partialSums[k]);
    }
    CurveProjective.copy(result, finalSum);
    toc();
    toc();
    return { result, log: getLog() };
  }

  /**
   * input: points and scalars
   *
   * output:
   * - points in 4 variants: G, -G, endo(G), -endo(G)
   *   with coordinates in Montgomery form
   * - scalars decomposed into 2 half-size chunks
   */
  function preparePointsAndScalars(
    pointPtr0: number,
    scalarPtr0: number,
    { N }: { N: number }
  ) {
    let sizeAffine4 = 4 * sizeAffine;
    let pointPtr = Field.global.getPointer(N * sizeAffine4);
    let sizeScalar2 = 2 * sizeScalar;
    let scalarPtr = Field.global.getPointer(N * sizeScalar2);

    let [i, iend] = range(N);
    let point = pointPtr + sizeAffine4 * i;
    let scalar = scalarPtr + sizeScalar2 * i;

    let point0 = pointPtr0 + sizeAffine * i;
    let scalarInput = scalarPtr0 + sizeScalar * i;

    for (
      ;
      i < iend;
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
    }

    return { pointPtr, scalarPtr };
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
      let bucketCountsK = bucketCounts[k];
      let startBucket = buckets[k][0];
      for (
        // we loop over implicit arrays of points by taking their starting pointers and incrementing by the size of one element
        // note: this time, we treat `G` and `endo(G)` as separate points, and iterate over 2N points.
        let i = 0, point = pointPtr;
        i < 2 * N;
        i++, point += sizeAffine2
      ) {
        let l = scalarSlicesK[i];
        let carry = l >>> 31;
        l &= 0x7f_ff_ff_ff;
        if (l === 0) continue;

        // compute the memory address in the bucket array where we want to store our point
        let l0 = bucketCountsK[l]++; // update start index, so the next point in this bucket lands at one position higher
        let newPtr = startBucket + l0 * sizeAffine; // this is where the point should be copied to

        // a point `A` and it's negation `-A` are stored next to each other
        let negPoint = point + sizeAffine;
        let ptr = carry === 1 ? negPoint : point; // this is the point that should be copied

        // copy point to the bucket array -- expensive operation! (but it pays off)
        CurveAffine.copy(newPtr, ptr);
      }
    }
  }

  function normalizeBucketsStorage(
    oldBuckets: Uint32Array[],
    chunksPerThread: Chunk[],
    toProjective = false
  ) {
    let size = toProjective ? sizeProjective : sizeAffine;
    let setZero = toProjective
      ? CurveProjective.setZero
      : (ptr: number) => CurveAffine.setIsNonZero(ptr, false);
    let copy = toProjective ? CurveProjective.fromAffine : CurveAffine.copy;

    // normalize the way buckets are stored
    let nChunks = chunksPerThread.length;
    let chunksWithBuckets: (Chunk & { buckets: Uint32Array })[] =
      Array(nChunks);

    for (let i = 0; i < nChunks; i++) {
      let chunk = chunksPerThread[i];
      let { k, length, lstart } = chunk;
      let buckets = Uint32Array.from(Field.local.getPointers(length, size));

      for (let l = 0; l < length; l++) {
        let bucket = oldBuckets[k][lstart + l - 1];
        let nextBucket = oldBuckets[k][lstart + l];
        if (bucket === nextBucket) {
          // empty bucket
          setZero(buckets[l]);
        } else {
          copy(buckets[l], bucket);
        }
      }

      chunksWithBuckets[i] = { ...chunk, buckets: buckets };
    }

    return chunksWithBuckets;
  }

  /**
   * computes a slice/"column" of the bucket reduction sum:
   *
   * column <- sum_{l=lstart..lend} l * buckets[l - lstart]
   *
   * defining L = lend - lstart, we can write the sum as
   *
   * sum_{l=0..L} (lstart + l) * buckets[l]
   * = (sum_{l=0..L} (l + 1) * buckets[l]) + (lstart - 1) * (sum_{l=0..L} buckets[l])
   * =: triangle + (lstart - 1) * row
   *
   * triangle and row are computed together in 2L additions, and
   * (lstart - 1) * row is a comparatively cheap O(log(L)) double-and-add
   */
  function reduceBucketsColumnProjective(
    column: number,
    buckets: Uint32Array,
    lstart: number
  ) {
    let L = buckets.length;
    let { addAssign, doubleInPlace } = CurveProjective;

    using _ = Field.local.atCurrentOffset;
    let scratch = Field.local.getPointers(20);
    let [triangle, row] = Field.local.getZeroPointers(2, sizeProjective);

    // compute triangle and row
    for (let l = L - 1; l >= 0; l--) {
      addAssign(scratch, row, buckets[l]);
      addAssign(scratch, triangle, row);
    }

    // triangle += (lstart - 1) * row
    lstart--;
    while (true) {
      if (lstart & 1) addAssign(scratch, triangle, row);
      if ((lstart >>= 1) === 0) break;
      doubleInPlace(scratch, row);
    }

    CurveProjective.copy(column, triangle);
  }

  return {
    msm,
    msmUnsafe(
      scalarPtr: number,
      pointPtr: number,
      N: number,
      verbose?: boolean,
      options?: { c?: number; c0?: number }
    ) {
      return msm(scalarPtr, pointPtr, N, verbose, {
        ...options,
        useSafeAdditions: false,
      });
    },
  };
}

/**
 * Represents a chunk of buckets, to be processed by a single thread.
 */
type Chunk = {
  /**
   * partition index
   */
  k: number;
  /**
   * index of this chunk within the partition
   */
  j: number;
  /**
   * index of the first bucket in this chunk, among all buckets of this partition
   */
  lstart: number;
  /**
   * number of buckets in this chunk
   */
  length: number;
};

function computeBucketsSplit(K: number, L: number) {
  let totalWork = K * L;
  let nt = Math.ceil(totalWork / THREADS);

  let chunksPerThread: Chunk[][] = [];
  let nChunksPerPartition: number[] = Array(K);

  let thread = 0;
  let remainingWork = nt;

  for (let k = 0; k < K; k++) {
    let j = 0;
    let remainingL = L;
    let lstart = 1;
    while (remainingL > 0) {
      let length = Math.min(remainingL, remainingWork);
      chunksPerThread[thread] ??= [];
      chunksPerThread[thread].push({ k, j, lstart, length });
      j++;
      remainingL -= length;
      lstart += length;
      remainingWork -= length;
      if (remainingWork === 0) {
        thread++;
        remainingWork = nt;
      }
    }
    nChunksPerPartition[k] = j;
  }

  return { chunksPerThread, nChunksPerPartition };
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

// timing/logging helpers

function createLog(isActive: boolean) {
  let timingStack: [string | undefined, number][] = [];
  let deferredLog: any[][] = [];

  if (REMOVE_ALL_LOGS)
    return {
      printLog: () => {},
      log: () => {},
      tic: () => {},
      toc: () => 0,
      getLog: () => [],
    };

  function printLog() {
    deferredLog.forEach((log) => isActive && console.log(...log));
    deferredLog = [];
  }

  function getLog() {
    return deferredLog;
  }

  function log(...args: any[]) {
    deferredLog.push(args);
  }

  function tic(label?: string) {
    timingStack.push([label, performance.now()]);
  }

  function toc() {
    let [label, start] = timingStack.pop()!;
    let time = performance.now() - start;
    if (label !== undefined) log(`${label}... ${time.toFixed(1)}ms`);
    return time;
  }

  return { printLog, getLog, log, tic, toc };
}
