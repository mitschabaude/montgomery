export {
  multiply,
  add,
  subtract,
  equals,
  storeField,
  storeFieldIn,
  emptyField,
  readField,
  freeField,
  reset,
  Field,
};

declare function multiply(out: number, x: number, y: number): void;
declare function add(out: number, x: number, y: number): void;
declare function subtract(out: number, x: number, y: number): void;
declare function equals(x: number, y: number): boolean;
declare function storeField(x: Field): number;
declare function storeFieldIn(x: Field, pointer: number): void;
declare function emptyField(): number;
declare function readField(x: number): Field;
declare function freeField(x: number): void;
declare function reset(): void;

type Field = [
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint
];
