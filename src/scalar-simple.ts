import type * as W from "wasmati";
import {
  constant,
  i32,
  Module,
  global,
  importMemory,
  type ModuleInstance,
} from "wasmati";
import { log2 } from "./util.ts";
import { memoryHelpers } from "./wasm/memory-helpers.ts";
import { extractBitSlice, fromPackedBytes } from "./wasm/field-helpers.ts";
import { montgomeryParams } from "./bigint/field-util.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";

export {
  createScalar,
  compileScalar,
  createScalarFromWasm,
  type Scalar,
  type ScalarParams,
};

type Scalar = UnwrapPromise<ReturnType<typeof createScalar>>;
type ScalarParams = { q: bigint; w: number };

/**
 * scalar module for basic MSM
 */
async function createScalar(params: ScalarParams) {
  return await createScalarFromWasm(params, await compileScalar(params));
}

/**
 * scalar module for basic MSM
 */
function scalarModule({ q, w }: { q: bigint; w: number }) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  let memSize = 1 << 14;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });

  return Module({
    exports: {
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(constant(() => i32.const(0))),
    },
  });
}

async function compileScalar(params: ScalarParams): Promise<WasmArtifacts> {
  let wasm = scalarModule(params);
  return { module: await wasm.compile(), importMap: wasm.importMap };
}

type ScalarInstance = ModuleInstance<ReturnType<typeof scalarModule>>;

async function createScalarFromWasm(
  params: ScalarParams,
  wasmArtifacts: WasmArtifacts
) {
  let { q, w } = params;
  const { n } = montgomeryParams(q, w, 1);
  let instance = (await WebAssembly.instantiate(
    wasmArtifacts.module,
    wasmArtifacts.importMap
  )) as ScalarInstance;
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
