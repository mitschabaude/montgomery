import type * as W from "wasmati"; // for type names
import { Const, Module, global, memory } from "wasmati";
import { FieldWithArithmetic } from "./field-arithmetic.js";
import { fieldInverse } from "./inverse.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { ImplicitMemory } from "./wasm-util.js";
import { mod } from "../finite-field-js.js";
import { curveOps } from "./curve.js";
import { jsHelpers, montgomeryParams } from "./helpers.js";
import { fromPackedBytes, toPackedBytes } from "./field-helpers.js";

export { F, wasm as ffWasm, helpers as ffHelpers };

// bls12-381
const p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
const beta =
  0x1a0111ea397fe699ec02408663d4de85aa0d857d89759ad4897d29650fb85f9b409427eb4f49fffd8bfd00000000aaacn;
const w = 30;

let { K, R, lengthP: N, n, nPackedBytes } = montgomeryParams(p, w);

let implicitMemory = new ImplicitMemory(memory({ min: 1 << 16 }));

let Field_ = FieldWithArithmetic(p, w);
let { multiply, square, leftShift } = multiplyMontgomery(p, w, {
  countMultiplications: false,
});
const Field = Object.assign(Field_, { multiply, square, leftShift });

let { inverse, makeOdd, batchInverse } = fieldInverse(implicitMemory, Field);
let { addAffine, endomorphism } = curveOps(implicitMemory, Field, beta);

let {
  isEqual,
  isGreater,
  isZero,
  add,
  subtract,
  subtractPositive,
  reduce,
  copy,
} = Field;

let module = Module({
  exports: {
    memory: implicitMemory.memory,
    dataOffset: global(Const.i32(implicitMemory.dataOffset)),
    // curve ops
    addAffine,
    endomorphism,
    // multiplication
    multiply,
    square,
    leftShift,
    // inverse
    inverse,
    makeOdd,
    batchInverse,
    // helpers
    isEqual,
    isGreater,
    isZero,
    fromPackedBytes: fromPackedBytes(w, n),
    toPackedBytes: toPackedBytes(w, n, nPackedBytes),
    // arithmetic
    add,
    subtract,
    subtractPositive,
    reduce,
    copy,
  },
});

let wasm = (await module.instantiate()).instance.exports;
let helpers = jsHelpers(p, w, wasm);

// put some constants in wasm memory

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

let memoryBytes = new Uint8Array(wasm.memory.buffer);

let { multiply: multiply_ } = wasm;

let F = {
  p,
  w,
  ...wasm,
  ...helpers,
  constants,
  memoryBytes,
  toMontgomery,
  fromMontgomery,
};

/**
 * @param scratch
 * @param invX inverted fields of at least length n
 * @param X fields to invert, at least length n
 * @param n length
 */
function batchInverseJs(
  [I, tmp]: number[],
  invX: number,
  X: number,
  n: number
) {
  if (n === 0) return;
  if (n === 1) {
    F.inverse(tmp, memoryBytes[invX + 0], memoryBytes[X + 0]);
    return;
  }
  // invX = [_, x0*x1, ..., x0*....*x(n-2), x0*....*x(n-1)]
  // invX[i] = x0*...*xi
  multiply_(memoryBytes[invX + 4], memoryBytes[X + 4], memoryBytes[X + 0]);
  for (let i = 2 * 4, N = n * 4; i < N; i += 4) {
    multiply_(
      memoryBytes[invX + i],
      memoryBytes[invX + i - 4],
      memoryBytes[X + i]
    );
  }
  // I = 1/(x0*....*x(n-1)) = 1/invX[n-1]
  F.inverse(tmp, I, memoryBytes[invX + 4 * (n - 1)]);

  for (let i = 4 * (n - 1); i > 4; i -= 4) {
    multiply_(memoryBytes[invX + i], memoryBytes[invX + i - 4], I);
    multiply_(I, I, memoryBytes[X + i]);
  }
  // now I = 1/(x0*x1)
  multiply_(memoryBytes[invX + 4], memoryBytes[X + 0], I);
  multiply_(memoryBytes[invX + 0], I, memoryBytes[X + 4]);
}
