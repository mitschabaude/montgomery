import { montgomeryParams } from "../field-util.js";

export { memoryHelpers };

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
  let obj = {
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
      let pointers: number[] = Array(N);
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
