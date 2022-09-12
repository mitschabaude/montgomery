export let memory: WebAssembly.Memory;

export function multiply(out: number, x: number, y: number): void;
export function square(out: number, x: number): void;
export function add(out: number, x: number, y: number): void;
export function subtract(out: number, x: number, y: number): void;
export function reduce(x: number): void;
export function addNoReduce(out: number, x: number, y: number): void;
export function subtractNoReduce(out: number, x: number, y: number): void;
export function isEqual(x: number, y: number): boolean;
export function isZero(x: number): boolean;
export function isGreater(x: number, y: number): boolean;
export function makeOdd(u: number, s: number): number;
// export function countTrailingZeroes(x: number): number;
export function shiftByWord(x: number): number;
export function copy(x: number, y: number): void;
// export function storeField(x: Field): number;
// export function storeFieldIn(pointer: number, x: Field | number): void;
// export function emptyField(): number;
// export function emptyFields(n: number): number;
// export function freeField(x: number): void;
// export function reset(): void;

export type Field = BigUint64Array;
