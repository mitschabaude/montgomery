import type * as W from "wasmati";
import { Const, Module, global, memory } from "wasmati";
import { barrettReduction } from "./wasm/barrett.js";
import { glv } from "./wasm/glv.js";
import { multiplySchoolbook } from "./wasm/multiply-schoolbook.js";
import { bigintFromBytes } from "./util.js";
import { memoryHelpers } from "./wasm/helpers.js";
import {
  extractBitSlice,
  fromPackedBytes,
  toPackedBytes,
} from "./wasm/field-helpers.js";
import { montgomeryParams } from "./ff-util.js";

export { createGlvScalar, GlvScalar };

type UnwrapPromise<T> = T extends Promise<infer U> ? U : never;
type GlvScalar = UnwrapPromise<ReturnType<typeof createGlvScalar>>;

async function createGlvScalar(q: bigint, lambda: bigint, w: number) {
  const { n, nPackedBytes, wn, wordMax } = montgomeryParams(lambda, w);

  const { multiply } = multiplySchoolbook(lambda, w);
  const { barrett } = barrettReduction(lambda, w, multiply);

  const { decompose, decomposeNoMsb } = glv(q, lambda, w, barrett);

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

  const glvHelpers = memoryHelpers(lambda, w, glvWasm);

  let [scratchPtr, , bytesPtr, bytesPtr2] = glvHelpers.getStablePointers(5);

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
      scratchPtr + glvHelpers.fieldSizeBytes
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