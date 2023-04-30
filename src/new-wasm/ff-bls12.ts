import {
  Const,
  Module,
  global,
  memory,
  // needed for TS
  Func,
  JSFunction,
} from "wasmati";
import { FieldWithArithmetic } from "./field-arithmetic.js";
import { fieldInverse } from "./inverse.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { ImplicitMemory } from "./wasm-util.js";
import { jsHelpers, montgomeryParams } from "./helpers.js";
import { mod } from "../finite-field-js.js";

export { F, wasm as ffWasm, helpers as ffHelpers };

// bls12-381
const p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const w = 30;

let { multiply, square, leftShift } = multiplyMontgomery(p, w, {
  countMultiplications: false,
});
const Field = FieldWithArithmetic(p, w);

let implicitMemory = new ImplicitMemory(memory({ min: 100 }));

let { inverse, makeOdd } = fieldInverse(
  implicitMemory,
  Field,
  multiply,
  leftShift
);
let { isEqual, isGreater, isZero, add, subtract, reduce, copy } = Field;

let module = Module({
  exports: {
    memory: implicitMemory.memory,
    dataOffset: global(Const.i32(implicitMemory.dataOffset)),
    multiply,
    square,
    leftShift,
    inverse,
    isEqual,
    isGreater,
    isZero,
    add,
    subtract,
    reduce,
    copy,
    makeOdd,
  },
});

let wasm = (await module.instantiate()).instance.exports;
let helpers = jsHelpers(p, w, wasm);

// put some constants in wasm memory
let { K, R, lengthP: N, n } = montgomeryParams(p, w);

let constantsBigint = {
  zero: 0n,
  one: 1n,
  p,
  R: mod(R, p),
  R2: mod(R * R, p),
  R2corr: mod(1n << BigInt(4 * K - 2 * N + 1), p),
  // common numbers in montgomery representation
  mg1: mod(1n * R, p),
  mg2: mod(2n * R, p),
  mg4: mod(4n * R, p),
  mg8: mod(8n * R, p),
};
let constantsKeys = Object.keys(constantsBigint);
let constantsPointers = helpers.getStablePointers(constantsKeys.length);

let constants = Object.fromEntries(
  constantsKeys.map((key, i) => {
    let pointer = constantsPointers[i];
    helpers.writeBigint(
      pointer,
      constantsBigint[key as keyof typeof constantsBigint]
    );
    return [key, pointer];
  })
) as Record<keyof typeof constantsBigint, number>;

function fromMontgomery(x: number) {
  wasm.multiply(x, x, constants.one);
  wasm.reduce(x);
}
function toMontgomery(x: number) {
  wasm.multiply(x, x, constants.R2);
}

let F = { p, w, ...wasm, ...helpers, constants, toMontgomery, fromMontgomery };
