import { montgomeryParams } from "../field-util.js";
import { THREADS, thread } from "../threads/threads.js";
import { assert } from "../util.js";

export { memoryHelpers, MemoryHelpers };

type MemoryHelpers = ReturnType<typeof memoryHelpers>;

/**
 * helpers for writing to and reading from wasm memory from JS
 *
 * @param p modulus
 * @param w word size
 * @param module wasm module
 */
function memoryHelpers(
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
    dataOffset?: { valueOf(): number };
  }
) {
  let { n, wn, wordMax, R, lengthP } = montgomeryParams(p, w);
  let packedSizeField = Math.ceil(lengthP / 8);
  let memoryBytes = new Uint8Array(memory.buffer);
  let initialOffset = dataOffset?.valueOf() ?? 0;

  let localRatio = 0.2;
  let totalLength = memoryBytes.length;
  let localLength = floorToMultipleOf4(totalLength * localRatio);
  let [global, local] = MemorySection.createGlobalAndLocal(
    memory,
    initialOffset,
    localLength,
    totalLength,
    n
  );

  let obj = {
    global,
    local,

    // TODO this is not correct, we arbitrarily reset the start of the local section,
    // so any pointers already written into the local section become invalid
    updateThreads() {
      let localLength = floorToMultipleOf4(totalLength * localRatio);
      let [global, local] = MemorySection.createGlobalAndLocal(
        memory,
        initialOffset,
        localLength,
        totalLength,
        n
      );
      let globalOffset = obj.global.offset;
      obj.global = global;
      obj.global.offset = globalOffset;
      let localOffset = obj.local.offset;
      obj.local = local;
      obj.local.offset = localOffset;
    },

    memoryBytes,
    n,
    R,
    // a field element has n limbs, each of which is an int32 (= 4 bytes)
    sizeField: 4 * n,
    packedSizeField,
    bitLength: lengthP,

    writeBigint(x: number, x0: bigint, length = n) {
      let arr = new Uint32Array(memory.buffer, x, length);
      for (let i = 0; i < length; i++) {
        arr[i] = Number(x0 & wordMax);
        x0 >>= wn;
      }
    },

    readBigint(x: number, length = n) {
      let arr = new Uint32Array(memory.buffer.slice(x, x + 4 * length));
      let x0 = 0n;
      let bitPosition = 0n;
      for (let i = 0; i < arr.length; i++) {
        x0 += BigInt(arr[i]) << bitPosition;
        bitPosition += wn;
      }
      return x0;
    },

    /**
     * @param size size of pointer (default: one field element)
     */
    getPointer(size = n * 4) {
      return obj.global.getPointer(size);
    },

    /**
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getPointers(N: number, size = n * 4) {
      return obj.global.getPointers(N, size);
    },

    /**
     * @param N
     */
    getStablePointers(N: number) {
      return obj.global.getStablePointers(N);
    },

    /**
     * @param size size of pointer (default: one field element)
     */
    getZeroPointer(size = n * 4) {
      return obj.global.getZeroPointers(1, size)[0];
    },

    /**
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getZeroPointers(N: number, size = n * 4) {
      return obj.global.getZeroPointers(N, size);
    },

    /**
     * store pointers to memory in memory themselves
     *
     * @param N
     * @param size size per pointer (default: one field element)
     */
    getPointersInMemory(N: number, size = n * 4): [Uint32Array, number] {
      let offset = obj.global.offset;
      // memory addresses must be multiples of 8 for BigInt64Arrays
      let length = ((N + 1) >> 1) << 1;
      let pointerPtr = offset;
      let pointers = new Uint32Array(memory.buffer, pointerPtr, length);
      offset += length * 4;
      for (let i = 0; i < N; i++) {
        pointers[i] = offset;
        offset += size;
      }
      obj.global.offset = offset;
      return [pointers, pointerPtr];
    },

    getEmptyPointersInMemory(N: number): [Uint32Array, number] {
      let offset = obj.global.offset;
      // memory addresses must be multiples of 8 for BigInt64Arrays
      let length = ((N + 1) >> 1) << 1;
      let pointerPtr = offset;
      let pointers = new Uint32Array(memory.buffer, pointerPtr, length);
      obj.global.offset += length * 4;
      return [pointers, pointerPtr];
    },

    resetPointers() {
      obj.global.offset = obj.global.initial;
    },

    getOffset() {
      return obj.global.offset;
    },

    setOffset(offset: number) {
      obj.global.offset = offset;
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
        memory.buffer.slice(bytesPtr, bytesPtr + packedSizeField)
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

class MemorySection {
  // fixed params
  initial: number;
  end: number;
  length: number;
  memory: WebAssembly.Memory;

  // default pointer size (= 1 field element) in uin32s
  n: number;

  // whether we have to take care of multiple threads operating on this memory section
  isShared: boolean;

  // where to get the next pointer
  _offset: number;
  get offset() {
    return this._offset;
  }
  set offset(offset: number) {
    assert(offset <= this.end, "memory overflow");
    this._offset = offset;
  }

  constructor(
    memory: WebAssembly.Memory,
    initialOffset: number,
    length: number,
    n: number,
    isShared: boolean
  ) {
    this.memory = memory;
    this.initial = initialOffset;
    this.end = initialOffset + length;
    this.length = length;
    this.n = n;
    this.isShared = isShared;

    this._offset = initialOffset;
  }

  sizeUsed() {
    return this.offset - this.initial;
  }
  sizeAvailable() {
    return this.end - this.offset;
  }

  // this will be called with `using section.atCurrentOffset`
  get atCurrentOffset() {
    let current = this.offset;
    return {
      [Symbol.dispose]: () => {
        // console.log(`resetting offset from ${this.offset} to ${current}`);
        this.offset = current;
      },
    };
  }

  static createGlobalAndLocal(
    memory: WebAssembly.Memory,
    offset: number,
    localLength: number,
    totalLength: number,
    n: number
  ) {
    let lengthPerThread = floorToMultipleOf4(localLength / THREADS);
    let localLengthActual = lengthPerThread * THREADS;

    let globalLength = totalLength - localLengthActual - offset;
    let globalSection = new MemorySection(
      memory,
      offset,
      globalLength,
      n,
      true
    );

    let localOffset = offset + globalLength + lengthPerThread * thread;
    let localSection = new MemorySection(
      memory,
      localOffset,
      lengthPerThread,
      n,
      false
    );

    return [globalSection, localSection];
  }

  /**
   * @param size size of pointer in bytes (default: one field element)
   */
  getPointer(size = this.n * 4) {
    let pointer = this.offset;
    this.offset += size;
    return pointer;
  }

  /**
   * @param N
   * @param size size per pointer (default: one field element)
   */
  getPointers(N: number, size = this.n * 4) {
    let pointers: number[] = Array(N);
    let offset = this.offset;
    for (let i = 0; i < N; i++) {
      pointers[i] = offset;
      offset += size;
    }
    this.offset = offset;
    return pointers;
  }

  /**
   * @param N
   * @param size size per pointer (default: one field element)
   */
  getZeroPointers(N: number, size = this.n * 4) {
    let offset = this.offset;
    assert(!this.isShared, "zero pointers only implemented for local memory");
    // TODO this logic is not valid, needs a lock
    if (this.isShared) {
      assert(size % 4 === 0, "pointer size must be a multiple of 4");
      // zero out the memory with Atomic.store
      let n = N * (size / 4);
      let arr = new Int32Array(this.memory.buffer, offset, n);
      for (let i = 0; i < n; i++) {
        Atomics.store(arr, i, 0);
      }
    } else {
      new Uint8Array(this.memory.buffer, offset, N * size).fill(0);
    }
    return this.getPointers(N, size);
  }

  /**
   * @param N
   */
  getStablePointers(N: number) {
    let pointers = this.getPointers(N);
    this.initial = this.offset;
    return pointers;
  }
}

function floorToMultipleOf4(x: number) {
  // ceil would be (Math.ceil(x) + 3) & ~3
  return Math.floor(x) & ~3;
}
