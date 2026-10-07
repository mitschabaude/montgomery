import type * as W from "wasmati";
import type { Instance } from "wasmati";
import type { scalarModule } from "./generate.ts";
import { log2 } from "./util.ts";
import { memoryHelpers } from "./wasm/memory-helpers.ts";
import { montgomeryParams } from "./bigint/field-util.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";

export { createScalar, type Scalar, type ScalarParams };

type Scalar = UnwrapPromise<ReturnType<typeof createScalar>>;
type ScalarParams = { q: bigint; w: number };

type ScalarInstance = Instance<ReturnType<typeof scalarModule>>;

/**
 * scalar module for basic MSM, from its compiled module
 */
async function createScalar(
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
