import { Module, call, func, i32, memory } from "wasmati";
import { mod } from "../bigint/field-util.ts";
import { inverse } from "../bigint/field.ts";
import { assert } from "../util.ts";
import { MemorySection } from "../wasm/memory-helpers.ts";
import { forLoop1 } from "../wasm/wasm-util.ts";
import { createField, mask64 } from "./field-base.ts";
import { arithmetic } from "./arithmetic.ts";
import { multiplyMontgomery } from "./multiply.ts";

export { Field, createWasm };

const Field = { create: createWasm };

async function createWasm(p: bigint, { memSize = 100 } = {}) {
  const F = createField(p);
  const ops = { ...arithmetic(F), ...multiplyMontgomery(F) };
  const wasmMemory = memory({ min: memSize, max: memSize });
  const benchMultiply = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(ops.multiply, [x, x, x]);
      });
    }
  );
  const benchSquare = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        call(ops.square, [x, x]);
      });
    }
  );
  const benchAddx3 = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        for (let j = 0; j < 3; j++) call(ops.add, [x, x, x]);
      });
    }
  );
  const benchSubx3 = func(
    { in: [i32, i32, i32], locals: [i32], out: [] },
    ([x, z, N], [i]) => {
      forLoop1(i, 0, N, () => {
        for (let j = 0; j < 3; j++) call(ops.subtract, [z, z, x]);
      });
    }
  );
  const module = Module({
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
    0,
    memSize * 65536,
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
