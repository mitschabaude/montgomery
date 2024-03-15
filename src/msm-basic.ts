/**
 * MSM implementation that only relies on the most basic curve interface: add, double, zero.
 *
 * We use this for Twisted Edwards curves which have neither endomorphisms nor a cheap batched addition algorithm.
 */
import type { MsmField } from "./field-msm.js";
import type { MemorySection } from "./wasm/memory-helpers.js";
import { splitBuckets } from "./msm-common.js";
import { Scalar } from "./scalar-simple.js";
import { log2 } from "./util.js";

export { createMsmBasic, msmBasic };

type MsmInputCurve = {
  Field: MsmField;
  Scalar: Scalar;
  Curve: {
    size: number;
    setZero: (P: number) => void;
    addAssign: (scratch: number[], P1: number, P2: number) => void;
    doubleInPlace: (scratch: number[], P: number) => void;
    copy: (target: number, source: number) => void;
  };
};

function createMsmBasic(inputs: MsmInputCurve) {
  return function (scalars: number[], points: number[], N: number) {
    return msmBasic(inputs, scalars, points, N);
  };
}

// mock
const THREADS = 16;

async function msmBasic(
  inputs: MsmInputCurve,
  scalars: number[],
  points: number[],
  N: number
) {
  let { Field, Scalar, Curve } = inputs;
  let b = Scalar.sizeInBits;
  let n = log2(N);
  let c = Math.max(n - 1, 1); // window size
  let K = Math.ceil(b / c);
  let L = 1 << c;
  let params = { N, K, L, c, b };

  let { addAssign, doubleInPlace, setZero } = Curve;
  let result = Field.global.getPointer(Curve.size);

  using _g = Field.global.atCurrentOffset;
  using _l = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(40);

  // K x N -> l in [0, L-1]
  let pointsToBucket: Uint32Array[] = Array(K);
  for (let k = 0; k < K; k++) {
    pointsToBucket[k] = new Uint32Array(new SharedArrayBuffer(4 * N));
  }
  // TODO adjust for signed digits
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < K; k++) {
      let l = Scalar.extractBitSlice(scalars[i], k * c, c);
      pointsToBucket[k][i] = l;
    }
  }

  let { chunksPerThread, chunkSumsPerPartition } = splitBuckets(
    inputs,
    params,
    THREADS
  );

  // TODO run in parallel
  for (let thread = 0; thread < THREADS; thread++) {
    for (let { j, k, lstart, length } of chunksPerThread[thread]) {
      using _l = Field.local.atCurrentOffset;
      let buckets = Uint32Array.from(
        Field.local.getPointers(length, Curve.size)
      );
      for (let l = 0; l < length; l++) setZero(buckets[l]);

      // accumulation
      for (let i = 0; i < N; i++) {
        let l = pointsToBucket[k][i] - lstart;
        if (l < 0 || l >= length) continue;
        addAssign(scratch, buckets[l], points[i]);
      }

      // reduce into sum
      let sum = chunkSumsPerPartition[k][j];
      reduceBucketsChunk(inputs, sum, buckets, lstart);
    }
  }

  // aggregate
  let partitionSums: number[] = Array(K);

  for (let k = 0; k < K; k++) {
    let chunkSums = chunkSumsPerPartition[k];
    let partitionSum = chunkSums[0];
    for (let j = 1, n = chunkSums.length; j < n; j++) {
      Curve.addAssign(scratch, partitionSum, chunkSums[j]);
    }
    partitionSums[k] = partitionSum;
  }

  // final summation
  Curve.copy(result, partitionSums[K - 1]);
  for (let k = K - 2; k >= 0; k--) {
    for (let i = 0; i < c; i++) {
      doubleInPlace(scratch, result);
    }
    addAssign(scratch, result, partitionSums[k]);
  }

  return result;
}

/**
 * computes a "column" of the bucket reduction sum:
 *
 * column := sum_{l=lstart..lend} l * buckets[l - lstart]
 *
 * defining L = lend - lstart, we can write the sum as
 *
 * = sum_{l=0..L} (lstart + l) * buckets[l]
 * = (sum_{l=0..L} (l + 1) * buckets[l]) + (lstart - 1) * (sum_{l=0..L} buckets[l])
 * =: triangle + (lstart - 1) * row
 *
 * - triangle and row are computed together in 2L additions
 * - (lstart - 1) * row is computed with double-and-add with O(log(lstart)) effort which is usually negligible
 */
function reduceBucketsChunk(
  {
    Field,
    Curve,
  }: { Field: { local: MemorySection }; Curve: MsmInputCurve["Curve"] },
  column: number,
  buckets: Uint32Array,
  lstart: number
) {
  let L = buckets.length;
  let { addAssign, doubleInPlace, setZero } = Curve;

  using _ = Field.local.atCurrentOffset;
  let scratch = Field.local.getPointers(20);
  let [triangle, row] = Field.local.getPointers(2, Curve.size);
  setZero(triangle);
  setZero(row);

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

  Curve.copy(column, triangle);
}
