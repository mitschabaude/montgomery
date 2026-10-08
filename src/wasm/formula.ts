import { call, i32, local, type Input, type Local } from "wasmati";
import type { FieldBackend } from "../field-backend.ts";
import type { ImplicitMemory } from "./wasm-util.ts";
import { assert } from "../util.ts";

export { fieldFormulas, type Fe, type FormulaContext };

/**
 * A field element in a curve formula: a memory pointer when the backend only
 * has Wasm functions, or locals when it has kernels.
 */
type Fe =
  | { ptr: () => Input<"i32"> }
  | { X: Local<"i64">[]; out?: [Pointer, number] };
type Pointer = Local<"i32"> | number;

/**
 * Write curve formulas once, for both kinds of backends. With kernels, all
 * field elements of a formula live in locals and nothing is called. Without,
 * elements are slots in contiguous scratch memory, inputs and outputs are used
 * in place, and every operation is a call: outputs must then be written after
 * the last read of any input they may alias.
 *
 * Kernels are used with `fuse`, if the backend has them. They make code much
 * larger, so they are for hot paths only. A function using fused formulas with
 * up to `nElements` field elements in locals declares `locals`. Every function
 * passes its locals object to `context()`.
 */
function fieldFormulas(
  Field: FieldBackend,
  implicitMemory: ImplicitMemory,
  { fuse, nElements = 0 }: { fuse: boolean; nElements?: number }
) {
  const K = fuse ? Field.kernels : undefined;
  const names = Array.from({ length: nElements }, (_, i) => `fe${i}`);
  const locals = K
    ? {
        ...K.locals,
        ...Object.fromEntries(names.map((name) => [name, K.element()])),
      }
    : {};
  const zeroPtr = implicitMemory.dataToOffset(Array(Field.size).fill(0));

  /**
   * @param L locals of the function
   * @param scratch contiguous scratch memory, used without kernels
   * @param maxScratch number of field elements available in scratch
   */
  function context(L: any, scratch: Local<"i32">, maxScratch: number) {
    let nLocal = 0;
    let nScratch = 0;
    const at = (ptr: Pointer, offset: number) => () =>
      typeof ptr === "number"
        ? ptr + offset
        : offset === 0
          ? ptr
          : i32.add(ptr, offset);
    const pointer = (x: Fe) => {
      assert("ptr" in x);
      return x.ptr();
    };
    const limbs = (x: Fe) => {
      assert("X" in x);
      return x.X;
    };
    const binary =
      (
        kernel: (L: any, Z: any, X: any, Y: any) => void,
        func: { kind: "function" } & any,
        out: string
      ) =>
      (z: Fe, x: Fe, y: Fe) => {
        if (K) kernel(L, limbs(z), limbs(x), limbs(y));
        else call(func, { [out]: pointer(z), x: pointer(x), y: pointer(y) });
      };

    function element(): Fe {
      if (K) {
        assert(nLocal < nElements, "formula needs more field elements");
        return { X: L[names[nLocal++]] };
      }
      assert(nScratch < maxScratch, "formula needs more scratch");
      return { ptr: at(scratch, Field.size * nScratch++) };
    }
    return {
      /** a fresh field element */
      element,
      /** the field element at ptr + offset; copied into locals with kernels */
      input(ptr: Pointer, offset = 0): Fe {
        if (!K) return { ptr: at(ptr, offset) };
        let x = element();
        K.load(limbs(x), ptr, offset);
        return x;
      },
      /**
       * destination at ptr + offset, written in place without kernels and by
       * `commit()` with kernels
       */
      output(ptr: Pointer, offset = 0): Fe {
        if (!K) return { ptr: at(ptr, offset) };
        let x = element();
        return { X: limbs(x), out: [ptr, offset] };
      },
      commit(...xs: Fe[]) {
        if (!K) return;
        for (let x of xs) {
          assert("out" in x && x.out !== undefined);
          K.store(x.out[0], x.X, x.out[1]);
        }
      },
      /** x = value at ptr + offset */
      load(x: Fe, ptr: Pointer, offset = 0) {
        if (K) K.load(limbs(x), ptr, offset);
        else call(Field.copy, { x: pointer(x), y: at(ptr, offset)() });
      },
      /** value at ptr + offset = x */
      store(ptr: Pointer, offset: number, x: Fe) {
        if (K) K.store(ptr, limbs(x), offset);
        else call(Field.copy, { x: at(ptr, offset)(), y: pointer(x) });
      },
      multiply: binary(K?.multiply!, Field.multiply, "xy"),
      square(z: Fe, x: Fe) {
        if (K) K.square(L, limbs(z), limbs(x));
        else call(Field.square, { xy: pointer(z), x: pointer(x) });
      },
      add: binary(K?.add!, Field.add, "out"),
      subtract: binary(K?.subtract!, Field.subtract, "out"),
      /** x + y, valid as input to multiplication */
      addLoose: binary(K?.add!, Field.addNoReduce, "out"),
      /** x - y, valid as input to multiplication */
      subtractLoose: binary(K?.subtract!, Field.subtractPositive, "out"),
      /** z = -x */
      negate(z: Fe, x: Fe) {
        if (K) {
          let zero = element();
          limbs(zero).forEach((zi) => local.set(zi, 0n));
          K.subtract(L, limbs(z), limbs(zero), limbs(x));
        } else
          call(Field.subtract, { out: pointer(z), x: zeroPtr, y: pointer(x) });
      },
      copy(z: Fe, x: Fe) {
        if (K) limbs(z).forEach((zi, i) => local.set(zi, limbs(x)[i]));
        else call(Field.copy, { x: pointer(z), y: pointer(x) });
      },
      /** canonical representative in [0, p) */
      reduce(x: Fe) {
        if (K) K.reduce(L, limbs(x));
        else call(Field.reduce, { x: pointer(x) });
      },
      /** pushes x == y, for canonical x, y */
      isEqual(x: Fe, y: Fe) {
        if (K) K.isEqual(limbs(x), limbs(y));
        else call(Field.isEqual, { x: pointer(x), y: pointer(y) });
      },
    };
  }
  return { locals, context, zeroPtr };
}

type FormulaContext = ReturnType<ReturnType<typeof fieldFormulas>["context"]>;
