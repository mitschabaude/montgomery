import { Module, call, func, i32, memory } from "wasmati";
import { mod } from "../bigint/field-util.ts";
import { inverse } from "../bigint/field.ts";
import { assert } from "../util.ts";
import { MemorySection } from "../wasm/memory-helpers.ts";
import { ImplicitMemory, forLoop1 } from "../wasm/wasm-util.ts";
import { createField, mask64 } from "./field-base.ts";
import { arithmetic } from "./arithmetic.ts";
import { multiplyMontgomery } from "./multiply.ts";
import { helpers } from "./helpers.ts";
import { fieldInverse } from "./inverse.ts";

export { Field, createWasm };

const Field = { create: createWasm };

async function createWasm(p: bigint, { memSize = 100 } = {}) {
  const F = createField(p);
  const wasmMemory = memory({ min: memSize, max: memSize });
  const implicitMemory = new ImplicitMemory(wasmMemory);
  const baseOps = { ...arithmetic(F), ...multiplyMontgomery(F) };
  const ops = {
    ...baseOps,
    ...fieldInverse(F, baseOps, implicitMemory),
    ...helpers(F, baseOps, implicitMemory),
  };
  const benchMultiply = func(
    { in: [{ x: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
    ({ x, N }, { i }) => {
      forLoop1(i, 0, N, () => {
        call(ops.multiply, { z: x, x, y: x });
      });
    }
  );
  const benchSquare = func(
    { in: [{ x: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
    ({ x, N }, { i }) => {
      forLoop1(i, 0, N, () => {
        call(ops.square, { z: x, x });
      });
    }
  );
  const benchAddx3 = func(
    { in: [{ x: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
    ({ x, N }, { i }) => {
      forLoop1(i, 0, N, () => {
        for (let j = 0; j < 3; j++) call(ops.add, { z: x, x, y: x });
      });
    }
  );
  const benchSubx3 = func(
    {
      in: [{ x: i32 }, { z: i32 }, { N: i32 }],
      locals: { i: i32 },
      out: [],
    },
    ({ x, z, N }, { i }) => {
      forLoop1(i, 0, N, () => {
        for (let j = 0; j < 3; j++) call(ops.subtract, { z, x: z, y: x });
      });
    }
  );
  const module = Module({
    memory: wasmMemory,
    exports: {
      ...ops,
      memory: wasmMemory,
      benchMultiply,
      benchSquare,
      benchAddx3,
      benchSubx3,
    },
  });
  const { instance } = await module.instantiate();
  const Wasm = instance.exports;
  // MemorySection's default allocation size is expressed in 32-bit words.
  const local = new MemorySection(
    Wasm.memory,
    implicitMemory.dataOffset,
    memSize * 65536 - implicitMemory.dataOffset,
    2 * F.n,
    false
  );
  const view = new DataView(Wasm.memory.buffer);

  function writeBigint(x: number, value: bigint) {
    assert(
      value >= 0n && value < F.R,
      "value must fit in the wide field layout"
    );
    for (let i = 0; i < F.n; i++, value >>= 64n)
      view.setBigUint64(x + 8 * i, value & mask64, true);
  }
  function readBigint(x: number) {
    let value = 0n;
    for (let i = F.n - 1; i >= 0; i--)
      value = (value << 64n) | view.getBigUint64(x + 8 * i, true);
    return value;
  }
  const [one, R2] = local.getStablePointers(2);
  writeBigint(one, 1n);
  writeBigint(R2, mod(F.R * F.R, p));
  function toMontgomery(x: number) {
    Wasm.multiply(x, x, R2);
  }
  function fromMontgomery(x: number) {
    Wasm.multiply(x, x, one);
    Wasm.reduce(x);
  }
  function fromBigint(x: number, value: bigint) {
    writeBigint(x, mod(value * F.R, p));
  }
  // Reading need not mutate the input or allocate temporary memory.
  const Rinv = inverse(F.R, p);
  function toBigint(x: number) {
    return mod(readBigint(x) * Rinv, p);
  }

  return {
    p,
    modulus: p,
    n: F.n,
    w: 64,
    R: F.R,
    limit: F.limit,
    lazy: F.lazy,
    size: F.size,
    sizeField: F.size,
    packedSizeField: Math.ceil(p.toString(2).length / 8),
    inverseScratchSize: 3 * F.size,
    batchInverseScratchSize: 4 * F.size,
    Wasm,
    Memory: { local },
    moduleBytes: module.toBytes(),
    writeBigint,
    readBigint,
    fromBigint,
    toBigint,
    toMontgomery,
    fromMontgomery,
  };
}
