export {
  multiply,
  add,
  subtract,
  reduceInPlace,
  addNoReduce,
  subtractNoReduce,
  equals,
  isZero,
  isGreater,
  makeOdd,
  countTrailingZeroes,
  shiftByWord,
  storeField,
  storeFieldIn,
  emptyField,
  freeField,
  reset,
  memory,
  Field,
};

declare let memory: WebAssembly.Memory;

function multiply(out: number, x: number, y: number): void;
function add(out: number, x: number, y: number): void;
function subtract(out: number, x: number, y: number): void;
function reduceInPlace(x: number): void;
function addNoReduce(out: number, x: number, y: number): void;
function subtractNoReduce(out: number, x: number, y: number): void;
function equals(x: number, y: number): boolean;
function isZero(x: number): boolean;
function isGreater(x: number, y: number): boolean;
function makeOdd(u: number, s: number): number;
function countTrailingZeroes(x: number): number;
function shiftByWord(x: number): number;
function storeField(x: Field): number;
function storeFieldIn(x: Field | number, pointer: number): void;
function emptyField(): number;
function freeField(x: number): void;
function reset(): void;

type Field = BigUint64Array;
