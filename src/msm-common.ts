import type { MemorySection } from "./wasm/memory-helpers.js";

export { splitBuckets, Chunk };

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

function splitBuckets(
  {
    Field,
    Curve,
  }: {
    Field: { global: MemorySection };
    Curve: { size: number; setZero(pointer: number): void };
  },
  params: {
    b: number;
    c: number;
    K: number;
    L: number;
  },
  THREADS: number
) {
  let { b, c, K, L } = params;
  let overlapBits = b % c;
  let Llast = 2 ** overlapBits;
  // log("expected points per bucket", {
  //   default: (4 * N) / L,
  //   last: (4 * N) / Llast,
  //   overlapBits,
  //   scalarBitlength: b,
  // });

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

  // allocate space for different threads' contribution to each partitions
  // K x (#chunks in this partition)
  let chunkSumsPerPartition: Uint32Array[] = Array(K);
  for (let k = 0; k < K; k++) {
    let nChunks = nChunksPerPartition[k];
    chunkSumsPerPartition[k] = new Uint32Array(nChunks);
    // note: each thread must compute this independently in the same way
    let chunkPtrs = Field.global.getPointers(nChunks, Curve.size);
    for (let j = 0; j < nChunks; j++) {
      chunkSumsPerPartition[k][j] = chunkPtrs[j];
    }
  }

  return { chunksPerThread, chunkSumsPerPartition };
}
