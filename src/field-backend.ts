import {
  Module,
  func,
  i64,
  type Func,
  type Input,
  type Local,
  type LocalArray,
  type Type,
  type ValueType,
  local,
} from "wasmati";
import { FieldWithArithmetic } from "./wasm/field-arithmetic.ts";
import { multiplyMontgomery } from "./wasm/multiply-montgomery.ts";
import { fieldInverse } from "./wasm/inverse.ts";
import { fieldExp } from "./wasm/exp.ts";
import { fromPackedBytes, toPackedBytes } from "./wasm/field-helpers.ts";
import { ImplicitMemory } from "./wasm/wasm-util.ts";
import { montgomeryParams } from "./bigint/field-util.ts";
import {
  createField as createWideField,
  wideParams,
} from "./wide/field-base.ts";
import { wideOps } from "./wide/field.ts";
import { fieldKernels } from "./wide/kernels.ts";
import { log2 } from "./util.ts";

export {
  createFieldBackend,
  fieldLayout,
  resolveFieldBackend,
  supportsWideArithmetic,
  type FieldBackend,
  type FieldBackendName,
  type FieldBackendOption,
  type FieldKernels,
  type FieldLayout,
};

/**
 * - `"29-bit"`: w-bit limbs (w = 29 by default) in 32-bit words, with spare
 *   bits that let curve formulas skip reductions.
 * - `"wide"`: full 64-bit limbs using Wasm wide arithmetic
 *   (`--wasm-wide-arithmetic`), about 2x faster arithmetic.
 */
type FieldBackendName = "29-bit" | "wide";
/** `"auto"` picks `"wide"` if the runtime supports Wasm wide arithmetic. */
type FieldBackendOption = FieldBackendName | "auto";

type MultiplyFunc = Func<[{ xy: "i32" }, { x: "i32" }, { y: "i32" }], []>;
type AddFunc = Func<[{ out: "i32" }, { x: "i32" }, { y: "i32" }], []>;
type Predicate = Func<[{ x: "i32" }, { y: "i32" }], ["i32"]>;

type FieldLayout = {
  name: FieldBackendName;
  p: bigint;
  /** bits per limb */
  w: number;
  /** number of limbs */
  n: number;
  /** bytes per field element */
  size: number;
  /** Montgomery radix */
  R: bigint;
  /** field elements passed between operations are in [0, limit) */
  limit: bigint;
};

/**
 * Wasm field arithmetic in Montgomery form, which the generic Wasm curve code
 * and the JS curve and MSM layers are written against.
 *
 * Operations take and return values in [0, limit). `addNoReduce` and
 * `subtractPositive` may skip reductions where a backend has spare bits: their
 * results are only valid as inputs to multiply and square.
 */
type FieldBackend = FieldLayout & {
  /** raw limbs of x, for data segments */
  bigintToData(x: bigint): number[];
  /** inline x = y */
  copyInline(x: Local<"i32">, y: Local<"i32">): void;

  multiply: MultiplyFunc;
  square: Func<[{ xy: "i32" }, { x: "i32" }], []>;
  add: AddFunc;
  subtract: AddFunc;
  addNoReduce: AddFunc;
  subtractPositive: AddFunc;
  /** canonical representative in [0, p) */
  reduce: Func<[{ x: "i32" }], []>;
  /** x = y */
  copy: Func<[{ x: "i32" }, { y: "i32" }], []>;
  /** raw comparisons of the stored representation */
  isEqual: Predicate;
  isGreater: Predicate;
  isZero: Func<[{ x: "i32" }], ["i32"]>;
  /** Montgomery inverse with three field elements of scratch */
  inverse: Func<[{ scratch: "i32" }, { r: "i32" }, { a: "i32" }], []>;
  /** batch Montgomery inverse with four field elements of scratch */
  batchInverse: Func<
    [{ scratch: "i32" }, { z: "i32" }, { x: "i32" }, { $n: "i32" }],
    []
  >;
  /** z = xIn^n for a raw exponent n, with x as one field element of scratch */
  exp: Func<[{ x: "i32" }, { z: "i32" }, { xIn: "i32" }, { n: "i32" }], []>;
  fromPackedBytes: Func<[{ x: "i32" }, { bytes: "i32" }], []>;
  toPackedBytes: Func<[{ bytes: "i32" }, { x: "i32" }], []>;

  /** arithmetic on locals for fused functions, if the backend has it */
  kernels?: FieldKernels;
};

type Element = Local<"i64">[];
/**
 * Field arithmetic on locals. A function using the kernels declares `locals`
 * and one `element()` per field element it holds, and passes its locals object
 * as `L`. Outputs may alias inputs.
 */
type FieldKernels = {
  locals: Record<string, Type<ValueType> | LocalArray>;
  element(): LocalArray<"i64">;
  load(X: Element, ptr: Input<"i32">, offset?: number): void;
  store(ptr: Input<"i32">, X: Element, offset?: number): void;
  multiply(L: any, Z: Element, X: Element, Y: Element): void;
  square(L: any, Z: Element, X: Element): void;
  add(L: any, Z: Element, X: Element, Y: Element): void;
  subtract(L: any, Z: Element, X: Element, Y: Element): void;
  reduce(L: any, X: Element): void;
  /** pushes X == Y (raw representations) */
  isEqual(X: Element, Y: Element): void;
};

function fieldLayout(
  name: FieldBackendName,
  p: bigint,
  { w = 29, minExtraBits }: { w?: number; minExtraBits?: number } = {}
): FieldLayout {
  if (name === "29-bit") {
    let { n, R } = montgomeryParams(p, w, minExtraBits);
    return { name, p, w, n, size: 4 * n, R, limit: 2n * p };
  }
  let { n, size, R, limit } = wideParams(p);
  return { name, p, w: 64, n, size, R, limit };
}

function createFieldBackend(
  name: FieldBackendName,
  p: bigint,
  implicitMemory: ImplicitMemory,
  options: { w?: number; minExtraBits?: number } = {}
): FieldBackend {
  let layout = fieldLayout(name, p, options);
  if (name === "wide") {
    let F = createWideField(p);
    let ops = wideOps(F, implicitMemory);
    return {
      ...layout,
      bigintToData: (x) =>
        Array.from({ length: F.size }, (_, i) =>
          Number((x >> BigInt(8 * i)) & 255n)
        ),
      copyInline(x, y) {
        for (let i = 0; i < F.n; i++)
          F.storeLimb(local.get(x), i, F.loadLimb(y, i));
      },
      ...ops,
      // There are no spare bits to skip reductions with.
      addNoReduce: ops.add,
      subtractPositive: ops.subtract,
      kernels: fieldKernels(F),
    };
  }
  let { w, n } = layout;
  let Field = FieldWithArithmetic(p, w, n);
  let { multiply, square, leftShift } = multiplyMontgomery(p, w, n, {
    countMultiplications: false,
  });
  let FieldWithMultiply = Object.assign(Field, { multiply, square, leftShift });
  let { inverse, batchInverse } = fieldInverse(
    implicitMemory,
    FieldWithMultiply
  );
  let packedSize = Math.ceil(log2(p) / 8);
  return {
    ...layout,
    bigintToData: Field.bigintToData,
    copyInline: Field.copyInline,
    multiply,
    square,
    add: Field.add,
    subtract: Field.subtract,
    addNoReduce: Field.addNoReduce,
    subtractPositive: Field.subtractPositive,
    reduce: Field.reduce,
    copy: Field.copy,
    isEqual: Field.isEqual,
    isGreater: Field.isGreater,
    isZero: Field.isZero,
    inverse,
    batchInverse,
    exp: fieldExp(FieldWithMultiply),
    fromPackedBytes: fromPackedBytes(w, n, packedSize),
    toPackedBytes: toPackedBytes(w, n, packedSize),
  };
}

function resolveFieldBackend(option: FieldBackendOption): FieldBackendName {
  if (option !== "auto") return option;
  return supportsWideArithmetic() ? "wide" : "29-bit";
}

let wideSupport: boolean | undefined;

function supportsWideArithmetic() {
  wideSupport ??= WebAssembly.validate(
    Module({
      exports: {
        probe: func(
          { in: [{ x: i64 }, { y: i64 }], out: [i64, i64] },
          ({ x, y }) => i64.mul_wide_u(x, y)
        ),
      },
    }).toBytes()
  );
  return wideSupport;
}
