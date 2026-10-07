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
import { log2 } from "./util.ts";
import {
  type Chunk,
  createLog,
  splitPartitions,
  windowSizeAffine,
} from "./msm-common.ts";

// work counters, and sizes of dynamically claimed units of work
const ACCUMULATE = 0;
const REDUCE = 1;
const UNITS_PER_THREAD = 4;
const POINTS_PER_CLAIM = 256;
// number of additions per batch inversion
const BATCH_SIZE = 512;

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
    let { bucketsPtr, locks, counters } = await broadcastFromMain(
      "buckets",
      () => {
        // bucket (k, l) is at bucketsPtr + (bases[k] + l - 1) * sizeAffine
        let bucketsPtr = Field.global.getPointer(nBuckets * sizeAffine);
        for (let b = 0; b < nBuckets; b++) {
          Affine.setIsNonZero(bucketsPtr + b * sizeAffine, false);
        }
        // one lock per bucket, held while an addition into it is in flight
        let locks = new Int32Array(new SharedArrayBuffer(4 * nBuckets));
        // work counters for the phases below, see `claim()`
        let counters = new Int32Array(new SharedArrayBuffer(4 * 2));
        return { bucketsPtr, locks, counters };
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
      let held = new Int32Array(B);
      let nPairs = 0;
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
        if (nPairs === B || Atomics.compareExchange(locks, b, 0, 1) !== 0) {
          retry.push(b, point);
          return;
        }
        let bucket = bucketsPtr + b * sizeAffine;
        if (memoryBytes[bucket + 2 * sizeField] === 0) {
          memoryBytes.copyWithin(bucket, point, point + sizeAffine);
          Atomics.store(locks, b, 0);
          return;
        }
        pairs[2 * nPairs] = bucket;
        pairs[2 * nPairs + 1] = point;
        held[nPairs] = b;
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
        if (useSafeAdditions) {
          Field.batchAdd(scratch[0], tmp, d, kinds, pairsPtr, nPairs);
        } else {
          Field.batchAddUnsafe(scratch[0], pairsPtr, nPairs);
        }
        for (let p = 0; p < nPairs; p++) Atomics.store(locks, held[p], 0);
        nPairs = 0;
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
      using _ = Field.local.atCurrentOffset;
      let projectiveChunks = normalizeBucketsStorage(
        bucketsPtr,
        chunksPerUnit[unit],
        bases
      );
      for (let { j, k, lstart, buckets } of projectiveChunks) {
        reduceBucketsColumnProjective(columnss[k][j], buckets, lstart);
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
   * copy this unit's buckets to projective points, which the reduction adds
   */
  function normalizeBucketsStorage(
    bucketsPtr: number,
    chunks: Chunk[],
    bases: number[]
  ) {
    return chunks.map((chunk) => {
      let { k, length, lstart } = chunk;
      let buckets = Uint32Array.from(
        Field.local.getPointers(length, sizeProjective)
      );
      let bucket = bucketsPtr + (bases[k] + lstart - 1) * sizeAffine;
      for (let l = 0; l < length; l++, bucket += sizeAffine) {
        if (memoryBytes[bucket + 2 * sizeField] === 0) {
          Projective.setZero(buckets[l]);
        } else {
          Projective.fromAffine(buckets[l], bucket);
        }
      }
      return { ...chunk, buckets };
    });
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
    let { addMixed, addAssign, doubleInPlace } = Projective;

    using _ = Field.local.atCurrentOffset;
    let scratch = Field.local.getPointers(20);
    let [triangle, row] = Field.local.getZeroPointers(2, sizeProjective);

    // compute triangle and row
    for (let l = L - 1; l >= 0; l--) {
      addMixed(scratch, row, row, buckets[l]);
      addAssign(scratch, triangle, row);
    }

    // triangle += (lstart - 1) * row
    lstart--;
    while (true) {
      if (lstart & 1) addAssign(scratch, triangle, row);
      if ((lstart >>= 1) === 0) break;
      doubleInPlace(scratch, row);
    }

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
