export let memory: WebAssembly.Memory;

export function multiply(out: number, x: number, y: number): void;
// export function square(out: number, x: number): void;
export function leftShift(out: number, x: number, k: number): void;
export function add(out: number, x: number, y: number): void;
export function subtract(out: number, x: number, y: number): void;
export function reduce(x: number): void;
export function addNoReduce(out: number, x: number, y: number): void;
export function subtractNoReduce(out: number, x: number, y: number): void;
export function isEqual(x: number, y: number): boolean;
export function isZero(x: number): boolean;
export function isGreater(x: number, y: number): boolean;
export function makeOdd(u: number, s: number): number;
export function copy(x: number, y: number): void;
export function toPackedBytes(bytes: number, x: number): void;
export function fromPackedBytes(x: number, bytes: number): void;

export const multiplyCount: number;
export function resetMultiplyCount(): void;
