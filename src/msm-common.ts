import { assert } from "./util.js";
import type { MemorySection } from "./wasm/memory-helpers.js";

export { windowSize, splitBuckets, Chunk, createLog };

const REMOVE_ALL_LOGS = false;

function windowSize(Field: { sizeInBits: number }, n: number) {
  return (
    windowSizeTable[Field.sizeInBits > 260 ? "large" : "small"][n] ??
    Math.max(n - 1, 1)
  );
}

/**
 * tables of the form `n: c`, which has msm window sizes for different n.
 * n is the log-size of scalar and point inputs.
 *
 * table was optimized with 16 threads on my laptop, with two different types of curves:
 * - 'large' (~384 bit base field)
 * - 'small' (~256 bit base field)
 *
 * @param c window size
 */
const windowSizeTable: {
  [k in "large" | "small"]: Record<number, number | undefined>;
} = {
  large: {
    14: 13,
    15: 14,
    16: 14,
    17: 14,
    18: 14,
    19: 18,
    20: 18,
  },
  // TODO
  small: {
    16: 12,
  },
};

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

/**
 * Split buckets among threads
 *
 * Note: this takes into account
 * - bucket sizes not being distributed evenly in the final partition
 * - peculiarity in the bucket distribution when the signed digits algorithm is used
 */
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
  // Ll = number of non-empty buckets in final partition
  let overlapBits = b % c;
  let Ll = overlapBits === 0 ? 1 : 1 << overlapBits; // the 1 is because overflow of carries in the signed digit algorithm
  let wl = overlapBits === 0 ? L / Ll / 2 ** 5 : L / Ll; // reduced weight in the overflow case

  let totalWork = (K - 1) * L + Ll * wl; // = K*L except in the overflow case
  let workPerThread = Math.ceil(totalWork / THREADS);

  let chunksPerThread: Chunk[][] = [];
  let nChunksPerPartition: number[] = Array(K);

  let thread = 0;
  let remainingForCurrentThread = workPerThread;

  for (let k = 0; k < K - 1; k++) {
    let j = 0;
    let remainingInThisPartition = L;
    let lstart = 1;
    while (remainingInThisPartition > 0) {
      let length = Math.min(
        remainingInThisPartition,
        remainingForCurrentThread
      );
      chunksPerThread[thread] ??= [];
      chunksPerThread[thread].push({ k, j, lstart, length });
      j++;
      remainingInThisPartition -= length;
      remainingForCurrentThread -= length;
      lstart += length;
      if (remainingForCurrentThread <= 0) {
        thread++;
        remainingForCurrentThread = workPerThread;
      }
    }
    nChunksPerPartition[k] = j;
  }
  {
    let k = K - 1;
    let j = 0;
    let remainingInThisPartition = Ll * wl;
    let lstart = 1;
    while (remainingInThisPartition > 0) {
      let length = Math.ceil(
        Math.min(remainingInThisPartition, remainingForCurrentThread) / wl
      );
      chunksPerThread[thread] ??= [];
      chunksPerThread[thread].push({ k, j, lstart, length });
      j++;
      remainingInThisPartition -= wl * length;
      remainingForCurrentThread -= wl * length;
      lstart += length;
      if (remainingInThisPartition <= 0) {
        // last chunk! push the remaining, empty buckets to this chunk as well?
        assert(lstart > Ll);
      }
      if (remainingForCurrentThread <= 0) {
        thread++;
        remainingForCurrentThread = workPerThread;
      }
    }
    assert(thread <= THREADS);

    nChunksPerPartition[k] = j;
  }

  // allocate space for different threads' contribution to each partition
  // K x (#chunks in this partition)
  let chunkSumsPerPartition: Uint32Array[] = Array(K);
  for (let k = 0; k < K; k++) {
    let nChunks = nChunksPerPartition[k];
    // note: each thread must compute these pointers independently in the same way
    chunkSumsPerPartition[k] = Uint32Array.from(
      Field.global.getPointers(nChunks, Curve.size)
    );
  }

  return { chunksPerThread, chunkSumsPerPartition };
}

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
