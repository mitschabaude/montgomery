import type * as W from "wasmati";
import { Const, Module, global, importMemory } from "wasmati";
import { glvGeneral } from "./wasm/glv.js";
import { assert, log2 } from "./util.js";
import { memoryHelpers } from "./wasm/memory-helpers.js";
import { extractBitSlice, fromPackedBytes } from "./wasm/field-helpers.js";
import { mod, montgomeryParams } from "./bigint/field-util.js";
import { UnwrapPromise, WasmArtifacts } from "./types.js";

export { createGlvScalar, GlvScalar, GlvScalarParams };

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
  if (wasmAndFullParams !== undefined) {
    let { wasm, fullParams } = wasmAndFullParams;
    return await createGlvScalarFromWasm(fullParams, wasm);
  }
  let { wasmArtifacts, instance, fullParams } =
    await createGlvScalarWasm(params);
  return await createGlvScalarFromWasm(fullParams, wasmArtifacts, instance);
}

/**
 * scalar module for MSM with GLV
 */
async function createGlvScalarWasm({ q, lambda, w }: Params) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);
  const { decompose, n0, maxBits } = glvGeneral(q, lambda, w, n);
  let memSize = 1 << 14;
  let wasmMemory = importMemory({ min: memSize, max: memSize, shared: true });

  let module = Module({
    exports: {
      decompose,
      fromPackedBytesSmall: fromPackedBytes(w, n0, Math.ceil(maxBits / 8)),
      fromPackedBytes: fromPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n0),
      extractBitSliceNoGlv: extractBitSlice(w, n),
      memory: wasmMemory,
      dataOffset: global(Const.i32(0)),
    },
  });

  let { instance, module: wasmModule } = await module.instantiate();
  return {
    wasmArtifacts: { module: wasmModule, memory: wasmMemory.value },
    instance,
    fullParams: { q, lambda, w, n, n0, maxBits },
  };
}

type GlvScalarWasm = UnwrapPromise<
  ReturnType<typeof createGlvScalarWasm>
>["instance"];

async function createGlvScalarFromWasm(
  params: GlvScalarParams,
  wasmArtifacts: WasmArtifacts,
  instance?: GlvScalarWasm
) {
  let { q, lambda, w, n, n0, maxBits } = params;
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
    )) as GlvScalarWasm;
  }
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
