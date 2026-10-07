import type * as W from "wasmati";
import {
  constant,
  i32,
  Module,
  global,
  importMemory,
  type Instance,
} from "wasmati";
import { glvGeneral } from "./wasm/glv.ts";
import { log2 } from "./util.ts";
import { memoryHelpers } from "./wasm/memory-helpers.ts";
import {
  decomposeAndSlice,
  extractBitSlice,
  fromPackedBytes,
} from "./wasm/field-helpers.ts";
import { mod, montgomeryParams } from "./bigint/field-util.ts";
import { type UnwrapPromise, type WasmArtifacts } from "./types.ts";

export { createGlvScalar, type GlvScalar, type GlvScalarParams };

type GlvScalar = UnwrapPromise<ReturnType<typeof createGlvScalar>>;
type Params = { q: bigint; lambda: bigint; w: number };
type GlvScalarParams = Params & { n: number; n0: number; maxBits: number };

/**
 * scalar module for MSM with GLV
 */
async function createGlvScalar(
  params: Params,
  wasmAndFullParams?: { wasm: WasmArtifacts; fullParams: GlvScalarParams }
) {
  let { wasm, fullParams } =
    wasmAndFullParams ?? (await compileGlvScalar(params));
  return await createGlvScalarFromWasm(fullParams, wasm);
}

/**
 * scalar module for MSM with GLV
 */
function glvScalarModule({ q, lambda, w }: Params) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  const { decompose, n0, maxBits } = glvGeneral(q, lambda, w, n);
  let memSize = 1 << 14;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });

  let wasm = Module({
    exports: {
      decompose,
      decomposeAndSlice: decomposeAndSlice(decompose, w, n, n0),
      fromPackedBytesSmall: fromPackedBytes(w, n0, Math.ceil(maxBits / 8)),
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n0),
      extractBitSliceNoGlv: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(constant(() => i32.const(0))),
    },
  });

  return { wasm, fullParams: { q, lambda, w, n, n0, maxBits } };
}

async function compileGlvScalar(params: Params) {
  let { wasm, fullParams } = glvScalarModule(params);
  let artifacts: WasmArtifacts = {
    module: await wasm.compile(),
    importMap: wasm.importMap,
  };
  return { wasm: artifacts, fullParams };
}

type GlvScalarInstance = Instance<ReturnType<typeof glvScalarModule>["wasm"]>;

async function createGlvScalarFromWasm(
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
