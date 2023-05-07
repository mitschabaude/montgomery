export let memory: WebAssembly.Memory;
export let dataOffset: WebAssembly.Global;

export declare function decompose(x: number): void;
export declare function decomposeNoMsb(x: number): number;
export declare function barrett(x: number): void;
export declare function multiplySchoolbook(
  xy: number,
  x: number,
  y: number
): void;
// helpers
export declare function toPackedBytes(bytes: number, x: number): void;
export declare function fromPackedBytes(x: number, bytes: number): void;
export declare function fromPackedBytesDouble(x: number, bytes: number): void;
export declare function extractBitSlice(
  x: number,
  startBit: number,
  bitLength: number
): number;
