import type * as W from "wasmati"; // for type names
import { Module, importMemory, type ModuleInstance } from "wasmati";
import { ImplicitMemory, copyMemory } from "./wasm/wasm-util.ts";
import { mod } from "./bigint/field-util.ts";
import { weierstraßOps } from "./wasm/curve-weierstrass.ts";
import { twistedEdwardsOps } from "./wasm/curve-twisted-edwards.ts";
import { type MemoryHelpers, memoryHelpers } from "./wasm/memory-helpers.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";
import { createSqrt } from "./field-sqrt.ts";
import { assert, log2 } from "./util.ts";
import { isMain } from "./threads/threads.ts";
import {
  createFieldBackend,
  fieldLayout,
  type FieldBackend,
  type FieldBackendName,
} from "./field-backend.ts";

export {
  createMsmField,
  compileField,
  createFieldFromWasm,
  type MsmField,
  type MsmFieldParams,
  type CurveType,
};
export { createConstants };

type CurveType = "weierstraß" | "twisted-edwards";

type MsmFieldParams<C extends CurveType | undefined = CurveType | undefined> = {
  p: bigint;
  /** the type of curve whose operations the module includes, if any */
  curve?: C;
  /** cube root of unity for the endomorphism of a Weierstraß curve */
  beta?: bigint;
  backend?: FieldBackendName;
  /** limb size of the 29-bit backend */
  w?: number;
  minExtraBits?: number;
  localRatio?: number;
};

async function createMsmField<C extends CurveType | undefined = undefined>(
  params: MsmFieldParams<C>
): Promise<MsmField<C>> {
  return await createFieldFromWasm(params, await compileField(params));
}

type MsmFieldInstance<C extends CurveType | undefined> = ModuleInstance<
  ReturnType<typeof fieldModule<C>>
>;
/** the field, with the Wasm operations of curves of type C */
type MsmField<C extends CurveType | undefined = undefined> = ReturnType<
  typeof fieldFromInstance
> &
  MsmFieldInstance<C>["exports"];

type CurveOps<C extends CurveType | undefined> = C extends "weierstraß"
  ? ReturnType<typeof weierstraßOps>
  : C extends "twisted-edwards"
    ? ReturnType<typeof twistedEdwardsOps>
    : {};

function fieldModule<C extends CurveType | undefined = undefined>({
  p,
  curve,
  beta,
  backend = "29-bit",
  w,
  minExtraBits,
}: MsmFieldParams<C>): FieldModule<C> {
  let memSize = 1 << 16;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });
  let implicitMemory = new ImplicitMemory(wasmMemory);

  let Field = createFieldBackend(backend, p, implicitMemory, {
    w,
    minExtraBits,
  });
  let curveOps = {} as CurveOps<C>;
  if (curve === "weierstraß") {
    assert(beta !== undefined, "Weierstraß curves need beta");
    curveOps = weierstraßOps(implicitMemory, Field, beta) as CurveOps<C>;
  }
  if (curve === "twisted-edwards") {
    curveOps = twistedEdwardsOps(implicitMemory, Field) as CurveOps<C>;
  }
  return Module({
    exports: { ...fieldExports(implicitMemory, Field), ...curveOps },
  });
}

// annotated, because declarations can't name the inferred type
type FieldModule<C extends CurveType | undefined> = ReturnType<
  typeof Module<ReturnType<typeof fieldExports> & CurveOps<C>>
>;

function fieldExports(implicitMemory: ImplicitMemory, Field: FieldBackend) {
  return {
    ...implicitMemory.getExports(),
    copyMemory: copyMemory(),
    // multiplication
    multiply: Field.multiply,
    square: Field.square,
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
  };
}

async function compileField(params: MsmFieldParams): Promise<WasmArtifacts> {
  let wasm = fieldModule(params);
  return { module: await wasm.compile(), importMap: wasm.importMap };
}

async function createFieldFromWasm<C extends CurveType | undefined = undefined>(
  params: Omit<MsmFieldParams<C>, "beta">,
  wasmArtifacts: WasmArtifacts
): Promise<MsmField<C>> {
  let instance = (await WebAssembly.instantiate(
    wasmArtifacts.module,
    wasmArtifacts.importMap
  )) as MsmFieldInstance<C>;
  return fieldFromInstance(
    params,
    instance.exports,
    wasmArtifacts
  ) as MsmField<C>;
}

function fieldFromInstance(
  params: Omit<MsmFieldParams, "beta">,
  wasm: MsmFieldInstance<undefined>["exports"],
  wasmArtifacts: WasmArtifacts
) {
  let { p, backend = "29-bit", w, minExtraBits, localRatio } = params;

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
