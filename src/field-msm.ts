import type * as W from "wasmati"; // for type names
import { Module, importMemory, type Instance } from "wasmati";
import { ImplicitMemory } from "./wasm/wasm-util.ts";
import { mod } from "./bigint/field-util.ts";
import { curveOps } from "./wasm/curve.ts";
import { type MemoryHelpers, memoryHelpers } from "./wasm/memory-helpers.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";
import { createSqrt } from "./field-sqrt.ts";
import { log2 } from "./util.ts";
import { isMain } from "./threads/threads.ts";
import {
  createFieldBackend,
  fieldLayout,
  type FieldBackendName,
} from "./field-backend.ts";

export { createMsmField, type MsmField, type MsmFieldParams };
export { createConstants };

type MsmFieldParams = {
  p: bigint;
  beta: bigint;
  backend?: FieldBackendName;
  /** limb size of the 29-bit backend */
  w?: number;
  minExtraBits?: number;
  localRatio?: number;
};

async function createMsmField(params: MsmFieldParams, wasm?: WasmArtifacts) {
  if (wasm !== undefined) {
    return await createFieldFromWasm(params, wasm);
  }
  let { instance, wasmArtifacts } = await createFieldWasm(params);
  return await createFieldFromWasm(params, wasmArtifacts, instance);
}

type MsmFieldInstance = Instance<ReturnType<typeof fieldModule>>;
type MsmField = UnwrapPromise<ReturnType<typeof createMsmField>>;

function fieldModule({
  p,
  beta,
  backend = "29-bit",
  w,
  minExtraBits,
}: MsmFieldParams) {
  let memSize = 1 << 16;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });
  let implicitMemory = new ImplicitMemory(wasmMemory);

  let Field = createFieldBackend(backend, p, implicitMemory, {
    w,
    minExtraBits,
  });
  let curve = curveOps(implicitMemory, Field, beta);

  return Module({
    exports: {
      ...implicitMemory.getExports(),
      // curve ops
      ...curve,
      // multiplication
      multiply: Field.multiply,
      square: Field.square,
      leftShift: Field.leftShift,
      exp: Field.exp,
      // inverse
      inverse: Field.inverse,
      /**
       * batch inversion, using 4 field elements of scratch space
       * @param scratch
       * @param xInvs
       * @param xs
       * @param n
       */
      batchInverse: Field.batchInverse,
      // arithmetic
      add: Field.add,
      addNoReduce: Field.addNoReduce,
      subtract: Field.subtract,
      subtractPositive: Field.subtractPositive,
      reduce: Field.reduce,
      copy: Field.copy,
      // helpers
      isEqual: Field.isEqual,
      isGreater: Field.isGreater,
      isZero: Field.isZero,
      fromPackedBytes: Field.fromPackedBytes,
      toPackedBytes: Field.toPackedBytes,
    },
  });
}

async function createFieldWasm(params: MsmFieldParams) {
  let wasm = fieldModule(params);
  let { instance, module } = await wasm.instantiate();
  return {
    wasmArtifacts: { module, importMap: wasm.importMap },
    instance,
  };
}

async function createFieldFromWasm(
  { p, backend = "29-bit", w, minExtraBits, localRatio }: MsmFieldParams,
  wasmArtifacts: WasmArtifacts,
  instance?: MsmFieldInstance
) {
  instance ??= (await WebAssembly.instantiate(
    wasmArtifacts.module,
    wasmArtifacts.importMap
  )) as MsmFieldInstance;
  let wasm = instance.exports;

  let layout = fieldLayout(backend, p, { w, minExtraBits });
  let { R, n, limit } = layout;
  let helpers = memoryHelpers(p, layout.w, n, wasm, localRatio);

  // put some constants in wasm memory

  let constants = createConstants(helpers, {
    zero: 0n,
    one: 1n,
    p,
    R: mod(R, p),
    R2: mod(R * R, p),
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
    w: layout.w,
    backend,
    /** field elements passed between operations are in [0, limit) */
    limit,
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

    sizeInBits: log2(p),

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
