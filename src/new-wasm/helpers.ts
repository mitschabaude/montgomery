import { log2 } from "../util.js";

export { montgomeryParams, jsHelpers };

/**
 * Compute the montgomery radix R=2^K and number of legs n
 * @param p modulus
 * @param w word size in bits
 */
function montgomeryParams(p: bigint, w: number) {
  // word size has to be <= 32, to be able to multiply 2 words as i64
  if (w > 32) {
    throw Error("word size has to be <= 32 for efficient multiplication");
  }
  // montgomery radix R should be R = 2^K > 2p,
  // where K is exactly divisible by the word size w
  // i.e., K = n*w, where n is the number of legs our field elements are stored in
  let lengthP = log2(p);
  let minK = lengthP + 1; // want 2^K > 2p bc montgomery mult. is modulo 2p
  // number of legs is smallest n such that K := n*w >= minK
  let n = Math.ceil(minK / w);
  let K = n * w;
  let R = 1n << BigInt(K);
  let wn = BigInt(w);
  return {
    n,
    K,
    R,
    wn,
    wordMax: (1n << wn) - 1n,
    lengthP,
    nPackedBytes: Math.ceil(lengthP / 8),
  };
}

/**
 *
 * @param p modulus
 * @param w word size
 * @param memory
 */
function jsHelpers(
  p: bigint,
  w: number,
  {
    memory,
    toPackedBytes,
    fromPackedBytes,
    dataOffset,
  }: {
    memory: WebAssembly.Memory;
    toPackedBytes?: (bytes: number, x: number) => void;
    fromPackedBytes?: (x: number, bytes: number) => void;
    dataOffset?: WebAssembly.Global;
  }
) {
  let { n, wn, wordMax, R, lengthP } = montgomeryParams(p, w);
  let nPackedBytes = Math.ceil(lengthP / 8);
  let memoryBytes = new Uint8Array(memory.buffer);
  let initialOffset = dataOffset?.valueOf() ?? 0;
  let obj = {
    n,
    R,
    bitLength: lengthP,
    fieldSizeBytes: 4 * n,
    packedSizeBytes: nPackedBytes,

    writeBigint(x: number, x0: bigint) {
      let arr = new Uint32Array(memory.buffer, x, n);
      for (let i = 0; i < n; i++) {
        arr[i] = Number(x0 & wordMax);
        x0 >>= wn;
      }
    },

    readBigInt(x: number, length = 1) {
      let arr = new Uint32Array(memory.buffer.slice(x, x + n * 4 * length));
      let x0 = 0n;
      let bitPosition = 0n;
      for (let i = 0; i < arr.length; i++) {
        x0 += BigInt(arr[i]) << bitPosition;
        bitPosition += wn;
      }
      return x0;
    },

    initial: initialOffset,
    offset: initialOffset,

    /**
     * @param size size of pointer (default: one field element)
     */
    getPointer(size = n * 4) {
      let pointer = obj.offset;
      obj.offset += size;
      return pointer;
    },

    /**
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getPointers(N: number, size = n * 4) {
      let pointers: number[] = Array(N);
      let offset = obj.offset;
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.offset = offset;
      return pointers;
    },

    /**
     * @param N
     */
    getStablePointers(N: number) {
      let pointers = obj.getPointers(N);
      obj.initial = obj.offset;
      return pointers;
    },

    /**
     * @param size size of pointer (default: one field element)
     */
    getZeroPointer(size = n * 4) {
      let offset = obj.offset;
      let pointer = obj.offset;
      memoryBytes.fill(0, offset, offset + size);
      obj.offset = offset + size;
      return pointer;
    },

    /**
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getZeroPointers(N: number, size = n * 4) {
      /**
       * @type {number[]}
       */
      let pointers = Array(N);
      let offset = obj.offset;
      new Uint8Array(memory.buffer, offset, N * size).fill(0);
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.offset = offset;
      return pointers;
    },

    /**
     * store pointers to memory in memory themselves
     *
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getPointersInMemory(N: number, size = n * 4): [Uint32Array, number] {
      let offset = obj.offset;
      // memory addresses must be multiples of 8 for BigInt64Arrays
      let length = ((N + 1) >> 1) << 1;
      let pointerPtr = offset;
      let pointers = new Uint32Array(memory.buffer, pointerPtr, length);
      offset += length * 4;
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.offset = offset;
      return [pointers, pointerPtr];
    },

    getEmptyPointersInMemory(N: number): [Uint32Array, number] {
      let offset = obj.offset;
      // memory addresses must be multiples of 8 for BigInt64Arrays
      let length = ((N + 1) >> 1) << 1;
      let pointerPtr = offset;
      let pointers = new Uint32Array(memory.buffer, pointerPtr, length);
      obj.offset += length * 4;
      return [pointers, pointerPtr];
    },

    resetPointers() {
      obj.offset = obj.initial;
    },

    getOffset() {
      return obj.offset;
    },

    /**
     * write field element from packed bytes representation
     */
    writeBytes([bytesPtr]: number[], pointer: number, bytes: Uint8Array) {
      let arr = new Uint8Array(memory.buffer, bytesPtr, 4 * n);
      arr.fill(0);
      arr.set(bytes);
      fromPackedBytes!(pointer, bytesPtr);
    },
    /**
     * read field element into packed bytes representation
     */
    readBytes([bytesPtr]: number[], pointer: number) {
      toPackedBytes!(bytesPtr, pointer);
      return new Uint8Array(
        memory.buffer.slice(bytesPtr, bytesPtr + nPackedBytes)
      );
    },
  };
  if (fromPackedBytes === undefined)
    obj.writeBytes = () => {
      throw Error("missing fromPackedBytes");
    };
  if (toPackedBytes === undefined)
    obj.readBytes = () => {
      throw Error("missing toPackedBytes");
    };
  return obj;
}
