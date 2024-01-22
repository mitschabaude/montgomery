import type * as W from "wasmati";
import { Const, Module, global, memory, importMemory } from "wasmati";
import { glv, glvGeneral } from "./wasm/glv.js";
import { assert, bigintFromBytes, log2 } from "./util.js";
import { memoryHelpers } from "./wasm/memory-helpers.js";
import {
  extractBitSlice,
  fromPackedBytes,
  toPackedBytes,
} from "./wasm/field-helpers.js";
import { mod, montgomeryParams } from "./bigint/field-util.js";
import { UnwrapPromise, WasmArtifacts } from "./types.js";

export {
  createGlvScalar,
  GlvScalar,
  GlvScalarParams,
  createSpecialGlvScalar,
  SpecialGlvScalar,
  createSimpleScalar,
  SimpleScalar,
};

type GlvScalar = UnwrapPromise<ReturnType<typeof createGlvScalar>>;
type SpecialGlvScalar = UnwrapPromise<
  ReturnType<typeof createSpecialGlvScalar>
>;
type SimpleScalar = UnwrapPromise<ReturnType<typeof createSimpleScalar>>;

type Params = { q: bigint; lambda: bigint; w: number };
type GlvScalarParams = Params & { n: number; n0: number; maxBits: number };

/**
 * scalar module for MSM with GLV
 */
async function createGlvScalar(
  params: Params,
  wasmAndFullParams?: {
    wasm: WasmArtifacts;
    fullParams: Params & { n: number; n0: number; maxBits: number };
  }
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
async function createGlvScalarWasm({
  q,
  lambda,
  w,
}: {
  q: bigint;
  lambda: bigint;
  w: number;
}) {
  const { n } = montgomeryParams(q, w, 1);
  const { decompose, n0, maxBits } = glvGeneral(q, lambda, w, n);
  let wasmMemory = importMemory({ min: 1 << 15, max: 1 << 15, shared: true });

  let module = Module({
    exports: {
      decompose,
      fromPackedBytesSmall: fromPackedBytes(w, n0),
      fromPackedBytes: fromPackedBytes(w, n),
      extractBitSlice: extractBitSlice(w, n0),
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
  params: {
    q: bigint;
    lambda: bigint;
    w: number;
    n: number;
    n0: number;
    maxBits: number;
  },
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
    wasmParams: { wasm: wasmArtifacts, fullParams: params },
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
  };
}

/**
 * scalar module for MSM with GLV
 */
async function createSpecialGlvScalar(q: bigint, lambda: bigint, w: number) {
  const { n, nPackedBytes, wn, wordMax } = montgomeryParams(lambda, w, 1);
  const { decompose, decomposeNoMsb } = glv(q, lambda, w, n);

  let module = Module({
    exports: {
      decompose,
      decomposeNoMsb,
      fromPackedBytes: fromPackedBytes(w, n),
      fromPackedBytesDouble: fromPackedBytes(w, 2 * n),
      toPackedBytes: toPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n),
      memory: memory({ min: 1 << 10 }),
      dataOffset: global(Const.i32(0)),
    },
  });

  let m = await module.instantiate();
  const glvWasm = m.instance.exports;

  const glvHelpers = memoryHelpers(lambda, w, n, glvWasm);

  let [scratchPtr, , bytesPtr, bytesPtr2] =
    glvHelpers.local.getStablePointers(5);

  function writeBytesDouble(pointer: number, bytes: Uint8Array) {
    let arr = new Uint8Array(glvWasm.memory.buffer, bytesPtr, 2 * 4 * n);
    arr.fill(0);
    arr.set(bytes);
    glvWasm.fromPackedBytesDouble(pointer, bytesPtr);
  }

  function writeBigintDouble(x: number, x0: bigint) {
    let arr = new Uint32Array(glvWasm.memory.buffer, x, 2 * n);
    for (let i = 0; i < 2 * n; i++) {
      arr[i] = Number(x0 & wordMax);
      x0 >>= wn;
    }
  }

  function testDecomposeScalar(scalar: bigint) {
    writeBigintDouble(scratchPtr, scalar);
    glvWasm.decompose(scratchPtr);

    let r = glvHelpers.readBytes([bytesPtr], scratchPtr);
    let l = glvHelpers.readBytes(
      [bytesPtr2],
      scratchPtr + glvHelpers.sizeField
    );
    let r0 = bigintFromBytes(r);
    let l0 = bigintFromBytes(l);

    let isCorrect = r0 + l0 * lambda === scalar;
    return isCorrect;
  }

  return {
    ...glvHelpers,
    ...glvWasm,
    writeBytesDouble,
    writeBigintDouble,
    testDecomposeScalar,
  };
}

/**
 * simple scalar utils for MSM without GLV
 */
async function createSimpleScalar(q: bigint, w: number) {
  const { n, nPackedBytes } = montgomeryParams(q, w, 1);

  let module = Module({
    exports: {
      fromPackedBytes: fromPackedBytes(w, n),
      toPackedBytes: toPackedBytes(w, n, nPackedBytes),
      extractBitSlice: extractBitSlice(w, n),
      memory: memory({ min: 1 << 10 }),
      dataOffset: global(Const.i32(0)),
    },
  });

  let m = await module.instantiate();
  const wasm = m.instance.exports;
  const helpers = memoryHelpers(q, w, n, wasm);

  return { ...helpers, ...wasm };
}
