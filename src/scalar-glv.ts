import type * as W from "wasmati";
import type { Instance } from "wasmati";
import type { glvScalarModule } from "./generate.ts";
import { log2 } from "./util.ts";
import { memoryHelpers } from "./wasm/memory-helpers.ts";
import { mod } from "./bigint/field-util.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";
import type { GlvScalarParams } from "./glv/glv.ts";

export { createGlvScalar, type GlvScalar };

type GlvScalar = UnwrapPromise<ReturnType<typeof createGlvScalar>>;

type GlvScalarInstance = Instance<ReturnType<typeof glvScalarModule>>;

/**
 * scalar module for MSM with GLV, from its compiled module
 */
async function createGlvScalar(
  params: GlvScalarParams,
  wasmArtifacts: WasmArtifacts
) {
  let { q, lambda, w, n, n0, maxBits } = params;
  let instance = (await WebAssembly.instantiate(
    wasmArtifacts.module,
    wasmArtifacts.importMap
  )) as GlvScalarInstance;
  const glvWasm = instance.exports;
  const glvHelpers = memoryHelpers(q, w, n, glvWasm);

  const sizeInBits = log2(q);

  let scratch = glvHelpers.local.getStablePointers(10);
  let [scratchPtr, scratchPtr2, scratchPtr3] = scratch;

  function testDecomposeScalar(scalar: bigint) {
    glvHelpers.writeBigint(scratchPtr, scalar);
    let negateFlags = glvWasm.decompose(scratchPtr2, scratchPtr3, scratchPtr);
    let s0Sign = negateFlags & 1 ? -1n : 1n;
    let s1Sign = negateFlags >> 1 ? -1n : 1n;

    let s0 = s0Sign * glvHelpers.readBigint(scratchPtr2, n0);
    let s1 = s1Sign * glvHelpers.readBigint(scratchPtr3, n0);

    let isCorrect = mod(s0 + s1 * lambda, q) === scalar;
    return isCorrect;
  }

  return {
    wasmArtifacts: { wasm: wasmArtifacts, fullParams: params },
    modulus: q,
    ...glvHelpers,
    // TODO this is brittle.. don't spread helpers object here, it has internal state
    // instead have a `memory` property on the field object, and use that everywhere
    updateThreads() {
      glvHelpers.updateThreads();
      this.global = glvHelpers.global;
      this.local = glvHelpers.local;
    },
    ...glvWasm,
    scratch,
    sizeInBits,
    maxBits,
    testDecomposeScalar,

    // "simple" scalar intf for basic MSM
    Simple: {
      sizeInBits,
      sizeField: glvHelpers.sizeField,
      extractBitSlice: glvWasm.extractBitSliceNoGlv,
    },
  };
}
