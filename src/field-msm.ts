import type * as W from "wasmati"; // for type names
import { Module, importMemory } from "wasmati";
import { FieldWithArithmetic } from "./wasm/field-arithmetic.js";
import { fieldInverse } from "./wasm/inverse.js";
import { multiplyMontgomery } from "./wasm/multiply-montgomery.js";
import { ImplicitMemory } from "./wasm/wasm-util.js";
import { mod, montgomeryParams } from "./bigint/field-util.js";
import { curveOps } from "./wasm/curve.js";
import { MemoryHelpers, memoryHelpers } from "./wasm/memory-helpers.js";
import { fromPackedBytes, toPackedBytes } from "./wasm/field-helpers.js";
import { UnwrapPromise, WasmArtifacts } from "./types.js";
import { fieldExp } from "./wasm/exp.js";
import { createSqrt } from "./field-sqrt.js";
import { assert } from "./util.js";
import { isMain } from "./threads/threads.js";

export { createMsmField, MsmField };
export { createConstants };

async function createMsmField(
  params: {
    p: bigint;
    beta: bigint;
    w: number;
    minExtraBits?: number;
    localRatio?: number;
  },
  wasm?: WasmArtifacts
) {
  if (wasm !== undefined) {
    return await createFieldFromWasm(params, wasm);
  }
  let { instance, wasmArtifacts } = await createFieldWasm(params);
  return await createFieldFromWasm(params, wasmArtifacts, instance);
}

type MsmFieldWasm = UnwrapPromise<
  ReturnType<typeof createFieldWasm>
>["instance"];
type MsmField = UnwrapPromise<ReturnType<typeof createMsmField>>;

async function createFieldWasm({
  p,
  beta,
  w,
  minExtraBits,
}: {
  p: bigint;
  beta: bigint;
  w: number;
  minExtraBits?: number;
}) {
  let { n, nPackedBytes } = montgomeryParams(p, w, minExtraBits);

  let memSize = 1 << 16;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });
  let implicitMemory = new ImplicitMemory(wasmMemory);

  let Field_ = FieldWithArithmetic(p, w, n);
  let { multiply, square, leftShift } = multiplyMontgomery(p, w, n, {
    countMultiplications: false,
  });
  const Field = Object.assign(Field_, { multiply, square, leftShift });

  let { inverse, makeOdd, batchInverse } = fieldInverse(implicitMemory, Field);
  let exp = fieldExp(Field);
  let { addAffine, addAffinePacked, endomorphism } = curveOps(
    implicitMemory,
    Field,
    inverse,
    beta
  );

  let {
    isEqual,
    isGreater,
    isZero,
    add,
    addNoReduce,
    subtract,
    subtractPositive,
    reduce,
    copy,
  } = Field;

  let module = Module({
    exports: {
      ...implicitMemory.getExports(),
      // curve ops
      addAffine,
      addAffinePacked,
      endomorphism,
      // multiplication
      multiply,
      square,
      leftShift,
      exp,
      // inverse
      inverse,
      makeOdd,
      /**
       * batch inversion, using 4 field elements of scratch space
       * @param scratch
       * @param xInvs
       * @param xs
       * @param n
       */
      batchInverse,
      // arithmetic
      add,
      addNoReduce,
      subtract,
      subtractPositive,
      reduce,
      copy,
      // helpers
      isEqual,
      isGreater,
      isZero,
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      toPackedBytes: toPackedBytes(w, n, nPackedBytes),
    },
  });

  // TODO: wasmati function which doesn't create the instance
  // also, this function still needs to carry the type, for example by returning the wasmati module,
  // and then we need a generic type from wasmati which infers the instance type from the module
  let { instance, module: wasmModule } = await module.instantiate();
  return {
    wasmArtifacts: { module: wasmModule, memory: wasmMemory.value },
    instance,
  };
}

async function createFieldFromWasm(
  {
    p,
    w,
    minExtraBits,
    localRatio,
  }: { p: bigint; w: number; minExtraBits?: number; localRatio?: number },
  wasmArtifacts: WasmArtifacts,
  instance?: MsmFieldWasm
) {
  if (instance === undefined) {
    let imports = WebAssembly.Module.imports(wasmArtifacts.module);
    // TODO abstraction leak - we have to know that there is no other import to do this
    // should work with any number of other imports, possibly by making memory import lazy and
    // add a module method to create the import object, with an override for the memory
    assert(imports.length === 1 && imports[0].kind === "memory");
    let { module, name } = imports[0];
    let importObject = { [module]: { [name]: wasmArtifacts.memory } };
    instance = (await WebAssembly.instantiate(
      wasmArtifacts.module,
      importObject
    )) as MsmFieldWasm;
  }
  let wasm = instance.exports;

  let { R, K, n, lengthP: N } = montgomeryParams(p, w, minExtraBits);
  let helpers = memoryHelpers(p, w, n, wasm, localRatio);

  // put some constants in wasm memory

  let constants = createConstants(helpers, {
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
  });

  function fromMontgomery(x: number) {
    wasm.multiply(x, x, constants.one);
    wasm.reduce(x);
  }
  function toMontgomery(x: number) {
    wasm.multiply(x, x, constants.R2);
  }

  let memoryBytes = new Uint8Array(wasm.memory.buffer);
  let { sqrt, t, roots } = createSqrt({ p }, wasm, helpers, constants);

  return {
    p,
    w,
    t,
    wasmArtifacts,
    ...wasm,
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
    addAffine: wasm.addAffine,
    /**
     * montgomery inverse, a 2^K -> a^(-1) 2^K (mod p)
     *
     * needs 3 fields of scratch space
     */
    inverse: wasm.inverse,
    ...helpers,
    // TODO this is brittle.. don't spread helpers object here, it has internal state
    // instead have a `memory` property on the field object, and use that everywhere
    updateThreads() {
      helpers.updateThreads();
      this.global = helpers.global;
      this.local = helpers.local;
    },
    constants,
    roots,
    memoryBytes,
    toMontgomery,
    fromMontgomery,
    sqrt,

    sizeInBits: N,

    fromBigint(xPtr: number, x: bigint) {
      helpers.writeBigint(xPtr, x);
      toMontgomery(xPtr);
    },
    toBigint(x: number) {
      fromMontgomery(x);
      let x0 = helpers.readBigint(x);
      toMontgomery(x);
      return x0;
    },
  };
}

function createConstants<const T extends Record<string, bigint>>(
  helpers: MemoryHelpers,
  constantsBigint: T
): Record<keyof T, number> {
  let constantsKeys = Object.keys(constantsBigint);
  let constantsPointers = helpers.global.getStablePointers(
    constantsKeys.length
  );

  return Object.fromEntries(
    constantsKeys.map((key, i) => {
      let pointer = constantsPointers[i];
      if (isMain()) {
        helpers.writeBigint(
          pointer,
          constantsBigint[key as keyof typeof constantsBigint]
        );
      }
      return [key, pointer];
    })
  ) as Record<keyof T, number>;
}
