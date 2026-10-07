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
import { broadcastFromMain } from "./threads/global-pool.ts";
import { THREADS, barrier, claim, isMain, thread } from "./threads/threads.ts";
import { assert, log2 } from "./util.ts";
import { createLog, splitPartitions, windowSizeAffine } from "./msm-common.ts";

// work counters, and sizes of dynamically claimed units of work
const ACCUMULATE = 0;
const REDUCE = 1;
const UNITS_PER_THREAD = 4;
const POINTS_PER_CLAIM = Number(process.env.MSM_P ?? 256);
// number of additions per batch inversion
const BATCH_SIZE = Number(process.env.MSM_B ?? 512);
// number of bucket columns reduced side by side
const REDUCE_COLUMNS = Number(process.env.MSM_J ?? 128);

export { createMsm, type MsmInputCurve };

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
 * 3. the partition sums are reduced into the final result, `S = P_0 + 2^c*P_1 + ... + 2^(c*(K-1))*P_(K-1)`
 */
function createMsm({
  params,
  Field,
  Scalar,
  Affine,
  Projective,
}: MsmInputCurve) {
  const { copy, subtract, endomorphism, sizeField, memoryBytes, constants } =
    Field;
  let { decompose, extractBitSlice, sizeField: sizeScalar } = Scalar;
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
   */
  async function msm(
    scalarPtr0: number,
    pointPtr0: number,
    N: number,
    verboseTiming = false,
    {
      c,
      useSafeAdditions = true,
    }: { c?: number; useSafeAdditions?: boolean } = {}
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
    // bit offset of each window, and index of each partition's first bucket
    let starts = Array(K);
    let bases = Array(K);
    for (let k = 0, start = 0, base = 0; k < K; k++) {
      starts[k] = start;
      bases[k] = base;
      start += cs[k];
      base += Ls[k];
    }
    let nBuckets = bases[K - 1] + Ls[K - 1];
    log({ n, K, c: cs.join(",") });

    let scratch = Field.local.getPointers(40);

    tic("prepare shared pointers");
    let { bucketsPtr, locks, batches, counters } = await broadcastFromMain(
      "buckets",
      () => {
        // bucket (k, l) is at bucketsPtr + (bases[k] + l - 1) * sizeAffine
        let bucketsPtr = Field.global.getPointer(nBuckets * sizeAffine);
        assert(THREADS < 256, "thread index fits in a lock word");
        // lock word of each bucket, see `tryAdd()`
        let locks = new Int32Array(new SharedArrayBuffer(4 * nBuckets));
        // number of completed batches of each thread, one per cache line
        let batches = new Int32Array(new SharedArrayBuffer(64 * THREADS));
        // work counters for the phases below, see `claim()`
        let counters = new Int32Array(new SharedArrayBuffer(4 * 2));
        return { bucketsPtr, locks, batches, counters };
      }
    );

    // ensure same pointer offsets in other threads
    if (!isMain()) Field.global.getPointer(nBuckets * sizeAffine);

    // split buckets into more units of work than threads, which threads
    // claim dynamically
    let nUnits = UNITS_PER_THREAD * THREADS;
    let { chunksPerUnit, chunkSumsPerPartition: columnss } = splitPartitions(
      { Field, Curve: Projective },
      Ls,
      nUnits
    );
    let pointPtr = Field.global.getPointer(N * 4 * sizeAffine);
    let scalarPtr = Scalar.global.getPointer(N * 2 * sizeScalar);
    toc();

    /**
     * Bucket accumulation
     * -------------------
     *
     * threads claim chunks of input points, and for each chunk
     * - store the points in the format we need: G, -G, endo(G), -endo(G)
     * - decompose scalars as `s = s0 + s1*lambda`, and slice s0, s1 into c-bit signed digits
     * - add each point into its bucket in every partition, in batches of
     *   affine additions which share one inversion
     *
     * an addition locks its bucket until its batch is done. if the bucket is
     * locked, by another thread or by an earlier addition in the same batch,
     * the addition is retried in the next batch.
     *
     * a bucket's lock word is 0 while the bucket is empty, and otherwise
     * records the last batch (thread t, batch number) that added into it. the
     * bucket is locked until thread t completes that batch, so a thread
     * unlocks all of a batch's buckets by counting its completed batches.
     */
    tic("bucket accumulation");
    {
      using _ = Field.local.atCurrentOffset;
      let B = BATCH_SIZE;
      let pairsPtr = Field.local.getPointer(8 * B);
      // scratch for safe additions
      let tmp = Field.local.getPointer(B * sizeField);
      let d = Field.local.getPointer(B * sizeField);
      let kinds = Field.local.getPointer(B);
      let pairs = new Uint32Array(memoryBytes.buffer, pairsPtr, 2 * B);
      let nPairs = 0;
      let batch = 1;
      let lockWord = (batch << 8) | (thread + 1);
      let retry: number[] = [];

      // signed digits of the current chunk's scalars, K per half scalar,
      // as bucket index and sign bit
      let slices = new Int32Array(2 * POINTS_PER_CLAIM * K);
      let j = 0;
      let jEnd = 0;
      let i0 = 0;
      let chunks = claim(counters, ACCUMULATE, N, POINTS_PER_CLAIM);

      // add point into bucket b, or schedule a retry
      let tryAdd = (b: number, point: number) => {
        let word = locks[b];
        if (
          nPairs === B ||
          (word !== 0 &&
            Atomics.load(batches, ((word & 255) - 1) << 4) < word >>> 8) ||
          Atomics.compareExchange(locks, b, word, lockWord) !== word
        ) {
          retry.push(b, point);
          return;
        }
        let bucket = bucketsPtr + b * sizeAffine;
        if (word === 0) {
          memoryBytes.copyWithin(bucket, point, point + sizeAffine);
          // unlock right away, with a batch number that is always completed
          Atomics.store(locks, b, thread + 1);
          return;
        }
        pairs[2 * nPairs] = bucket;
        pairs[2 * nPairs + 1] = point;
        nPairs++;
      };

      // slice the next chunk's scalars, returns false when all are claimed
      let nextChunk = () => {
        let next = chunks.next();
        if (next.done) return false;
        let [i, iend] = next.value;
        preparePointsAndScalars(
          pointPtr0,
          scalarPtr0,
          pointPtr,
          scalarPtr,
          i,
          iend
        );
        i0 = 2 * i;
        j = 0;
        jEnd = 2 * (iend - i) * K;
        for (
          let h = i0, scalar = scalarPtr + sizeScalar * h, jj = 0;
          h < 2 * iend;
          h++, scalar += sizeScalar
        ) {
          let isNonZero =
            memoryBytes[pointPtr + h * 2 * sizeAffine + 2 * sizeField];
          for (let k = 0, carry = 0; k < K; k++, jj++) {
            let L = Ls[k];
            let l = extractBitSlice(scalar, starts[k], cs[k]) + carry;
            if (l > L) {
              l = 2 * L - l;
              carry = 1;
            } else {
              carry = 0;
            }
            slices[jj] =
              l === 0 || isNonZero === 0
                ? -1
                : (bases[k] + l - 1) | (carry << 31);
          }
        }
        return true;
      };

      let flush = () => {
        if (nPairs === 0) return;
        if (useSafeAdditions) {
          Field.batchAdd(scratch[0], tmp, d, kinds, pairsPtr, nPairs);
        } else {
          Field.batchAddUnsafe(scratch[0], pairsPtr, nPairs);
        }
        nPairs = 0;
        // unlock this batch's buckets
        Atomics.store(batches, thread << 4, batch);
        batch++;
        lockWord = (batch << 8) | (thread + 1);
      };

      let sizeAffine2 = 2 * sizeAffine;
      let hasInput = nextChunk();
      while (hasInput || retry.length > 0 || nPairs > 0) {
        // retries first, then new input until the batch is full
        if (retry.length > 0) {
          let old = retry;
          retry = [];
          for (let r = 0; r < old.length; r += 2) tryAdd(old[r], old[r + 1]);
        }
        while (hasInput && nPairs < B) {
          if (j === jEnd) {
            hasInput = nextChunk();
            continue;
          }
          let slice = slices[j];
          if (slice !== -1) {
            let h = i0 + Math.floor(j / K);
            // a point `A` and its negation `-A` are stored next to each other
            let point =
              pointPtr + h * sizeAffine2 + (slice >>> 31) * sizeAffine;
            tryAdd(slice & 0x7f_ff_ff_ff, point);
          }
          j++;
        }
        flush();
      }
    }
    toc();

    tic("bucket accumulation (wait)");
    await barrier();
    toc();

    // second computation stage: reduce buckets into columns, per claimed unit
    tic("bucket reduction");
    for (let [unit] of claim(counters, REDUCE, nUnits)) {
      for (let { j, k, lstart, length } of chunksPerUnit[unit]) {
        let b0 = bases[k] + lstart - 1;
        reduceBuckets(
          scratch,
          columnss[k][j],
          bucketsPtr,
          locks,
          b0,
          lstart,
          length
        );
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
    pointPtr: number,
    scalarPtr: number,
    i: number,
    iend: number
  ) {
    let sizeAffine4 = 4 * sizeAffine;
    let sizeScalar2 = 2 * sizeScalar;
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
  }

  /**
   * computes the contribution of a chunk of n buckets, starting at bucket b0,
   * to its partition sum:
   *
   * column <- sum_{l=lstart..lstart+n-1} l * B_l
   *
   * the buckets are split into J columns of m consecutive buckets, which are
   * reduced side by side, so that each step is a batch of J independent affine
   * additions. column j starts at bucket s_j = lstart + j*m, and yields
   *
   * triangle_j = sum_{i<m} (i + 1) * B_(s_j + i), row_j = sum_{i<m} B_(s_j + i)
   *
   * in 2m additions. the columns combine as
   *
   * sum_j (triangle_j + (s_j - 1) * row_j)
   * = sum_j triangle_j + m * (sum_j j * row_j) + (lstart - 1) * (sum_j row_j)
   *
   * in O(J) projective additions and two double-and-adds.
   */
  function reduceBuckets(
    scratch: number[],
    column: number,
    bucketsPtr: number,
    locks: Int32Array,
    b0: number,
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
    let tmp = Field.local.getPointer(J * sizeField);
    let d = Field.local.getPointer(J * sizeField);
    let kinds = Field.local.getPointer(J);
    let pairs = new Uint32Array(memoryBytes.buffer, pairsPtr, 2 * J);

    // empty buckets are common, so we need safe additions
    let addRows = () => {
      for (let j = 0; j < J; j++) {
        pairs[2 * j] = triangles[j];
        pairs[2 * j + 1] = rows[j];
      }
      Field.batchAdd(scratch[0], tmp, d, kinds, pairsPtr, J);
    };
    for (let i = m - 1; i >= 0; i--) {
      if (i < m - 1) addRows();
      let p = 0;
      // only the last column can be shorter than m
      for (let j = 0, l = i; j < J && l < n; j++, l += m) {
        // skip empty buckets, whose memory is uninitialized
        if (locks[b0 + l] === 0) continue;
        pairs[2 * p] = rows[j];
        pairs[2 * p + 1] = bucketsPtr + (b0 + l) * sizeAffine;
        p++;
      }
      Field.batchAdd(scratch[0], tmp, d, kinds, pairsPtr, p);
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
      options?: { c?: number; c0?: number }
    ) {
      return msm(scalarPtr, pointPtr, N, verbose, {
        ...options,
        useSafeAdditions: false,
      });
    },
  };
}
