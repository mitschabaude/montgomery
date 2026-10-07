/**
 * The main MSM implementation for Weierstraß curves, based on batched-affine additions.
 *
 * Assumes a=0 and that the curve has an endomorphism based on cube roots of 1.
 */
import { type CurveParams } from "./bigint/affine-weierstrass.ts";
import { type CurveAffine } from "./curve-affine.ts";
import { type CurveProjective } from "./curve-projective.ts";
import { type MsmField } from "./field-msm.ts";
import { type GlvScalar } from "./scalar-glv.ts";
import { THREADS, barrier, claim, isMain } from "./threads/threads.ts";
import { assert, log2 } from "./util.ts";
import { createLog, splitPartitions, windowSizeAffine } from "./msm-common.ts";

// work counters, and sizes of dynamically claimed units of work
const PREPARE = 0;
const ACCUMULATE = 1;
const REDUCE = 2;
const POINTS_PER_CLAIM = 256;
// half points per claimed chunk of a partition's points
const HALF_POINTS_PER_CLAIM = 2048;
const REDUCE_UNITS_PER_THREAD = 4;
// number of additions per batch inversion
const BATCH_SIZE = 512;
// number of bucket columns reduced side by side
const REDUCE_COLUMNS = 128;
// maximum number of partitions
const MAX_K = 256;

/**
 * Shared state of one MSM call, which the main thread passes to all threads:
 * work counters, then per partition: claimed half points and claimed copies,
 * then whether copy r of partition k has points, at k*R + r.
 */
function createMsmShared() {
  let size = 3 + 2 * MAX_K + MAX_K * (THREADS + 2);
  return new Int32Array(new SharedArrayBuffer(4 * size));
}

export { createMsm, createMsmShared, type MsmInputCurve };

type MsmInputCurve = {
  params: CurveParams;
  Field: MsmField;
  Scalar: GlvScalar;
  Affine: CurveAffine;
  Projective: CurveProjective;
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
 * for each partition k, points `G_i` are added into `L = 2^(c_k-1)` _buckets_ according to the ḱth NAF slice of their scalar `s_i`.
 * in total, we end up with `K*L` buckets, which are indexed by `(k, l)` where `k = 0,...K-1` and `l = 1,...,L`.
 *
 * computation proceeds in **three main steps:**
 * 1. each bucket is accumulated into a single point, the _bucket sum_ `B_(l,k)`, which is simply the sum of all points in the bucket.
 * 2. the bucket sums of each partition k are reduced into a partition sum `P_k = 1*B_(k, 1) + 2*B_(k, 2) + ... + L*B_(k, L)`.
 * 3. the partition sums are reduced into the final result, `S = P_0 + 2^c_0*P_1 + ... + 2^(c_0 + ... + c_(K-2))*P_(K-1)`
 *
 * threads add points into their own copies of a partition's buckets, so that buckets stay in a core's cache and need no
 * locks. the copies are summed up in the reduction.
 */
function createMsm({
  params,
  Field,
  Scalar,
  Affine,
  Projective,
}: MsmInputCurve) {
  const { sizeField, memoryBytes } = Field;
  let { sizeField: sizeScalar } = Scalar;
  const b = Scalar.maxBits;

  let sizeAffine = Affine.size;
  let sizeProjective = Projective.size;

  /**
   *
   * @param scalarPtr0 pointer to array of scalars `s_0, ..., s_(N-1)`
   * @param pointPtr0 pointer to array of points `G_0, ..., G_(N-1)`
   * @param N number of scalars/points
   * @param verboseTiming whether to log timing information
   * @param options optional msm parameters `c`, `c0` (this is only needed when trying out different parameters
   * than our well-optimized, hard-coded ones; see {@link cTable})
   * @param shared state shared by all threads, from {@link createMsmShared}
   */
  async function msm(
    scalarPtr0: number,
    pointPtr0: number,
    N: number,
    verboseTiming = false,
    {
      c,
      useSafeAdditions = true,
    }: { c?: number; useSafeAdditions?: boolean } = {},
    shared = createMsmShared()
  ) {
    let { tic, toc, log, getLog } = createLog(verboseTiming && isMain());
    tic("msm total");

    let result = Field.global.getPointer(sizeProjective);
    using _g = Field.global.atCurrentOffset;
    using _l = Field.local.atCurrentOffset;
    using _s = Scalar.global.atCurrentOffset;
    let n = log2(N);
    // pick window size if it was not passed in
    c ??= windowSizeAffine(Field, n);

    let K = Math.ceil((b + 1) / c); // number of partitions
    // window sizes c_k differ by at most 1 and add up to b + 1 (one bit for
    // the carry of signed digits), so that even the last partition has about
    // L = 2^(c_k - 1) buckets. its additions would serialize otherwise.
    let cs = Array.from({ length: K }, (_, k) => Math.floor((b + 1 + k) / K));
    let Ls = cs.map((ck) => 2 ** (ck - 1));
    log({ n, K, c: cs.join(",") });

    let scratch = Field.local.getPointers(40);

    tic("prepare shared pointers");
    // each partition's points are accumulated into up to R copies of its
    // buckets, by threads that claim chunks of the points
    let R0 = Math.ceil(THREADS / K);
    let R = R0 + 2;
    assert(K <= MAX_K, `at most ${MAX_K} partitions`);
    let counters = shared;
    let pointsClaimed = (k: number) => 3 + k;
    let copiesClaimed = (k: number) => 3 + MAX_K + k;
    let copiesUsed = shared.subarray(3 + 2 * MAX_K);

    let maxL = Math.max(...Ls);
    let bucketsPtr = Field.global.getPointer(K * R * maxL * sizeAffine);
    // pointer to bucket l of copy r in partition k
    let bucketPtr = (k: number, r: number, l: number) =>
      bucketsPtr + ((k * R + r) * maxL + l - 1) * sizeAffine;

    // split buckets into more units of work than threads, which threads
    // claim dynamically
    let nUnits = REDUCE_UNITS_PER_THREAD * THREADS;
    let { chunksPerUnit, chunkSumsPerPartition: columnss } = splitPartitions(
      { Field, Curve: Projective },
      Ls,
      nUnits
    );
    let pointPtr = Field.global.getPointer(N * 4 * sizeAffine);
    // signed digit of each half scalar h in each partition k, at k*2N + h,
    // as bucket index l in 1..L_k and sign bit. 0 if there is no bucket
    let slicesPtr = Scalar.global.getPointer(4 * K * 2 * N);
    let slices = new Int32Array(
      Scalar.memoryBytes.buffer,
      slicesPtr,
      K * 2 * N
    );
    // scratch for preparing a chunk
    let scalarScratch = Scalar.local.getPointer(2 * sizeScalar);
    let scalarFlags = Scalar.local.getPointer(POINTS_PER_CLAIM);
    let flags = Field.local.getPointer(POINTS_PER_CLAIM);
    toc();

    /**
     * Preparation
     * -----------
     *
     * threads claim chunks of input points, and for each chunk
     * - store the points in the format we need: G, -G, endo(G), -endo(G)
     * - decompose scalars as `s = s0 + s1*lambda`, and slice s0, s1 into c_k-bit signed digits
     */
    tic("prepare points & scalars");
    // windows of c_k = c0 bits for k < kHi, and c0 + 1 bits for k >= kHi
    let c0 = cs[0];
    let kHi = cs.indexOf(c0 + 1) === -1 ? K : cs.indexOf(c0 + 1);
    for (let [i, iend] of claim(counters, PREPARE, N, POINTS_PER_CLAIM)) {
      let n = iend - i;
      Scalar.decomposeAndSlice(
        slicesPtr + 4 * 2 * i,
        scalarFlags,
        scalarPtr0 + i * sizeScalar,
        scalarScratch,
        n,
        2 * N,
        K,
        c0,
        kHi
      );
      memoryBytes.set(
        Scalar.memoryBytes.subarray(scalarFlags, scalarFlags + n),
        flags
      );
      Field.preparePoints(
        pointPtr + i * 4 * sizeAffine,
        pointPtr0 + i * sizeAffine,
        flags,
        n
      );
      // zero points don't go into buckets
      for (; i < iend; i++) {
        if (memoryBytes[pointPtr0 + i * sizeAffine + 2 * sizeField] !== 0) {
          continue;
        }
        for (let k = 0; k < K; k++) {
          slices[k * 2 * N + 2 * i] = 0;
          slices[k * 2 * N + 2 * i + 1] = 0;
        }
      }
    }
    toc();

    tic("prepare points & scalars (wait)");
    await barrier();
    toc();

    /**
     * Bucket accumulation
     * -------------------
     *
     * a thread claims a copy of a partition's buckets, and adds the points of
     * chunks that it claims while the partition has points left. threads are
     * spread evenly over partitions first. after that, they help the partition
     * with the most points left, which balances the work of all partitions.
     */
    tic("bucket accumulation");
    while (true) {
      let k = -1;
      let unit = Atomics.add(counters, ACCUMULATE, 1);
      if (unit < K * R0) {
        k = unit % K;
      } else {
        for (let k1 = 0, mostLeft = 0; k1 < K; k1++) {
          let left = 2 * N - Atomics.load(counters, pointsClaimed(k1));
          if (left > mostLeft) [k, mostLeft] = [k1, left];
        }
      }
      if (k === -1) break;
      let r = Atomics.add(counters, copiesClaimed(k), 1);
      if (r >= R) break;
      let hasPoints = accumulateBuckets(
        scratch,
        bucketPtr(k, r, 1),
        Ls[k],
        claim(counters, pointsClaimed(k), 2 * N, HALF_POINTS_PER_CLAIM),
        slices.subarray(k * 2 * N, (k + 1) * 2 * N),
        pointPtr,
        useSafeAdditions
      );
      if (hasPoints) copiesUsed[k * R + r] = 1;
    }
    toc();

    tic("bucket accumulation (wait)");
    await barrier();
    toc();

    // second computation stage: sum up the copies and reduce buckets into
    // columns, per claimed unit
    tic("bucket reduction");
    for (let [unit] of claim(counters, REDUCE, nUnits)) {
      for (let { j, k, lstart, length } of chunksPerUnit[unit]) {
        let copies: number[] = [];
        for (let r = 0; r < R; r++) {
          if (copiesUsed[k * R + r]) copies.push(bucketPtr(k, r, lstart));
        }
        reduceBuckets(scratch, columnss[k][j], copies, lstart, length);
      }
    }
    toc();

    tic("bucket reduction (wait)");
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
        Projective.addAssign(scratch, partitionSum, columns[j]);
      }
    }
    let partialSums = columnss.map((column) => column[0]);
    toc();

    tic("final sum");
    let finalSum = Field.global.getPointer(sizeProjective);
    let k = K - 1;
    Projective.copy(finalSum, partialSums[k]);
    k--;
    for (; k >= 0; k--) {
      for (let j = 0; j < cs[k]; j++) {
        Projective.doubleInPlace(scratch, finalSum);
      }
      Projective.addAssign(scratch, finalSum, partialSums[k]);
    }
    Projective.copy(result, finalSum);
    toc();

    log(Field.global.printMaxSizeUsed());
    log(Field.local.printMaxSizeUsed());
    toc();
    return { result, log: getLog() };
  }

  /**
   * accumulates the n buckets of a partition, stored from `buckets` on: adds
   * the points in each of the claimed chunks into the buckets given by their
   * signed digits in `slices`. returns whether there were any points.
   *
   * additions are done in batches which share one inversion. an addition into
   * a bucket that is already part of the current batch is retried in the next.
   */
  function accumulateBuckets(
    scratch: number[],
    buckets: number,
    n: number,
    chunks: Generator<[number, number]>,
    slices: Int32Array,
    pointPtr: number,
    useSafeAdditions: boolean
  ) {
    let chunk = chunks.next();
    if (chunk.done) return false;
    let [h, hEnd] = chunk.value;

    using _ = Field.local.atCurrentOffset;
    for (let l = 0; l < n; l++) {
      memoryBytes[buckets + l * sizeAffine + 2 * sizeField] = 0;
    }
    let B = BATCH_SIZE;
    let pairsPtr = Field.local.getPointer(8 * B);
    // scratch for safe additions
    let kinds = Field.local.getPointer(B);
    let pairs = new Uint32Array(memoryBytes.buffer, pairsPtr, 2 * B);
    let nPairs = 0;
    // the last batch that added into each bucket
    let batches = new Int32Array(n);
    let batch = 1;
    let retry: number[] = [];

    // add point into bucket l, or schedule a retry
    let add = (l: number, point: number) => {
      if (nPairs === B || batches[l] === batch) {
        retry.push(l, point);
        return;
      }
      let bucket = buckets + l * sizeAffine;
      if (memoryBytes[bucket + 2 * sizeField] === 0) {
        Affine.copy(bucket, point);
        return;
      }
      batches[l] = batch;
      pairs[2 * nPairs] = bucket;
      pairs[2 * nPairs + 1] = point;
      nPairs++;
    };

    let sizeAffine2 = 2 * sizeAffine;
    let hasPoints = true;
    while (hasPoints || retry.length > 0) {
      // retries first, then new points until the batch is full. with few
      // buckets, it may never be full, so we also stop when there are as
      // many retries as fit in a batch
      if (retry.length > 0) {
        let old = retry;
        retry = [];
        for (let r = 0; r < old.length; r += 2) add(old[r], old[r + 1]);
      }
      while (hasPoints && nPairs < B && retry.length < 2 * B) {
        if (h === hEnd) {
          chunk = chunks.next();
          if (chunk.done) hasPoints = false;
          else [h, hEnd] = chunk.value;
          continue;
        }
        let slice = slices[h];
        if (slice !== 0) {
          // a point `A` and its negation `-A` are stored next to each other
          let point = pointPtr + h * sizeAffine2 + (slice >>> 31) * sizeAffine;
          add((slice & 0x7f_ff_ff_ff) - 1, point);
        }
        h++;
      }
      if (useSafeAdditions) {
        Field.batchAdd(scratch[0], kinds, pairsPtr, nPairs);
      } else {
        Field.batchAddUnsafe(scratch[0], pairsPtr, nPairs);
      }
      nPairs = 0;
      batch++;
    }
    return true;
  }

  /**
   * computes the contribution of the n buckets l = lstart, ..., lstart + n - 1
   * of a partition to the partition sum, where each bucket B_l is the sum of
   * its copies, stored from `copies[r]` on:
   *
   * column <- sum_{l=lstart..lstart+n-1} l * B_l
   *
   * the buckets are split into J columns of m consecutive buckets, which are
   * reduced side by side, so that each step is a batch of J independent affine
   * additions. column j starts at bucket s_j = lstart + j*m, and yields
   *
   * triangle_j = sum_{i<m} (i + 1) * B_(s_j + i), row_j = sum_{i<m} B_(s_j + i)
   *
   * in (R + 1)m additions, for R copies. the columns combine as
   *
   * sum_j (triangle_j + (s_j - 1) * row_j)
   * = sum_j triangle_j + m * (sum_j j * row_j) + (lstart - 1) * (sum_j row_j)
   *
   * in O(J) projective additions and two double-and-adds.
   */
  function reduceBuckets(
    scratch: number[],
    column: number,
    copies: number[],
    lstart: number,
    n: number
  ) {
    using _ = Field.local.atCurrentOffset;
    let m = Math.ceil(n / REDUCE_COLUMNS);
    let J = Math.ceil(n / m);
    let triangles = Field.local.getPointers(J, sizeAffine);
    let rows = Field.local.getPointers(J, sizeAffine);
    for (let j = 0; j < J; j++) {
      Affine.setIsNonZero(triangles[j], false);
      Affine.setIsNonZero(rows[j], false);
    }
    let pairsPtr = Field.local.getPointer(8 * J);
    let kinds = Field.local.getPointer(J);
    let pairs = new Uint32Array(memoryBytes.buffer, pairsPtr, 2 * J);

    // empty buckets are common, so we need safe additions
    let addRows = () => {
      for (let j = 0; j < J; j++) {
        pairs[2 * j] = triangles[j];
        pairs[2 * j + 1] = rows[j];
      }
      Field.batchAdd(scratch[0], kinds, pairsPtr, J);
    };
    for (let i = m - 1; i >= 0; i--) {
      if (i < m - 1) addRows();
      for (let buckets of copies) {
        let p = 0;
        // only the last column can be shorter than m
        for (let j = 0, l = i; j < J && l < n; j++, l += m, p++) {
          pairs[2 * p] = rows[j];
          pairs[2 * p + 1] = buckets + l * sizeAffine;
        }
        Field.batchAdd(scratch[0], kinds, pairsPtr, p);
      }
    }
    addRows();

    // combine the columns in projective coordinates
    let { addAssign, doubleInPlace } = Projective;
    let [triangle, row, jRow, P] = Field.local.getZeroPointers(
      4,
      sizeProjective
    );
    for (let j = J - 1; j >= 0; j--) {
      Projective.fromAffine(P, triangles[j]);
      addAssign(scratch, triangle, P);
      Projective.fromAffine(P, rows[j]);
      addAssign(scratch, row, P);
      // row = sum_{j' >= j} row_j', so this adds row_j' j' times
      if (j > 0) addAssign(scratch, jRow, row);
    }
    // triangle += s * P, for s = m and s = lstart - 1
    let scaleAdd = (P: number, s: number) => {
      while (true) {
        if (s & 1) addAssign(scratch, triangle, P);
        if ((s >>= 1) === 0) break;
        doubleInPlace(scratch, P);
      }
    };
    scaleAdd(jRow, m);
    scaleAdd(row, lstart - 1);
    Projective.copy(column, triangle);
  }

  return {
    msm,
    msmUnsafe(
      scalarPtr: number,
      pointPtr: number,
      N: number,
      verbose?: boolean,
      options?: { c?: number },
      shared?: Int32Array<SharedArrayBuffer>
    ) {
      return msm(
        scalarPtr,
        pointPtr,
        N,
        verbose,
        { ...options, useSafeAdditions: false },
        shared
      );
    },
  };
}
