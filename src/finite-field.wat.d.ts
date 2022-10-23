export let memory: WebAssembly.Memory;

export function multiply(out: number, x: number, y: number): void;
export function square(out: number, x: number): void;
export function leftShift(out: number, x: number, k: number): void;
export function barrett(x: number): void;
export function multiplySchoolbook(xy: number, x: number, y: number): void;
export function add(out: number, x: number, y: number): void;
export function subtract(out: number, x: number, y: number): void;
export function reduce(x: number): void;
export function addNoReduce(out: number, x: number, y: number): void;
export function subtractNoReduce(out: number, x: number, y: number): void;
export function subtractPositive(out: number, x: number, y: number): void;
export function isEqual(x: number, y: number): boolean;
export function isZero(x: number): boolean;
export function isGreater(x: number, y: number): boolean;
export function makeOdd(u: number, s: number): number;
export function copy(x: number, y: number): void;
export function toPackedBytes(bytes: number, x: number): void;
export function fromPackedBytes(x: number, bytes: number): void;

/**
 * affine EC addition, G3 = G1 + G2
 *
 * assuming d = 1/(x2 - x1) is given, and inputs aren't zero, and x1 !== x2
 * (edge cases are handled one level higher, before batching)
 *
 * this supports addition with assignment where G3 === G1 (but not G3 === G2)
 * @param scratch
 * @param G3 (x3, y3)
 * @param G1 (x1, y1)
 * @param G2 (x2, y2)
 * @param d 1/(x2 - x1)
 */
export function addAffine(
  scratch: number,
  G3: number,
  G1: number,
  G2: number,
  d: number
): void;

/**
 * compute r = a^(-1) * 2^k mod p, returns k
 *
 * @param scratch
 * @param r
 * @param a
 */
export function almostInverseMontgomery(
  scratch: number,
  r: number,
  a: number
): number;

/**
 * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
 *
 * @param scratch
 * @param r
 * @param a
 */
export function inverse(scratch: number, r: number, a: number): void;

export const multiplyCount: number;
export function resetMultiplyCount(): void;
export const inverseCount: number;
export function resetInverseCount(): void;
