import type * as W from "wasmati";
import { Const, Module, global, importMemory } from "wasmati";
import { assert, log2 } from "./util.js";
import { memoryHelpers } from "./wasm/memory-helpers.js";
import { extractBitSlice, fromPackedBytes } from "./wasm/field-helpers.js";
import { montgomeryParams } from "./bigint/field-util.js";
import { UnwrapPromise, WasmArtifacts } from "./types.js";

export { createScalar, Scalar, ScalarParams };

type Scalar = UnwrapPromise<ReturnType<typeof createScalar>>;
type ScalarParams = { q: bigint; w: number };

/**
 * scalar module for basic MSM
 */
async function createScalar(params: ScalarParams, wasm?: WasmArtifacts) {
  if (wasm !== undefined) {
    return await createScalarFromWasm(params, wasm);
  }
  let { wasmArtifacts, instance } = await createScalarWasm(params);
  return await createScalarFromWasm(params, wasmArtifacts, instance);
}

/**
 * scalar module for basic MSM
 */
async function createScalarWasm({ q, w }: { q: bigint; w: number }) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  let memSize = 1 << 14;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });

  let module = Module({
    exports: {
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(Const.i32(0)),
    },
  });

  let { instance, module: wasmModule } = await module.instantiate();
  return {
    wasmArtifacts: { module: wasmModule, memory: wasmMemory.value },
    instance,
  };
}

type ScalarWasm = UnwrapPromise<
  ReturnType<typeof createScalarWasm>
>["instance"];

async function createScalarFromWasm(
  params: ScalarParams,
  wasmArtifacts: WasmArtifacts,
  instance?: ScalarWasm
) {
  let { q, w } = params;
  const { n } = montgomeryParams(q, w, 1);
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
    )) as ScalarWasm;
  }
  const wasm = instance.exports;
  const helpers = memoryHelpers(q, w, n, wasm);

  const sizeInBits = log2(q);

  let scratch = helpers.local.getStablePointers(10);

  return {
    wasmArtifacts,
    modulus: q,
    ...helpers,
    // TODO this is brittle.. don't spread helpers object here, it has internal state
    // instead have a `memory` property on the field object, and use that everywhere
    updateThreads() {
      helpers.updateThreads();
      this.global = helpers.global;
      this.local = helpers.local;
    },
    ...wasm,
    scratch,
    sizeInBits,

    toBigint(s: number) {
      return helpers.readBigint(s);
    },
    fromBigint(s: bigint) {
      let sPtr = helpers.local.getPointer();
      return helpers.writeBigint(sPtr, s);
    },
  };
}
