/**
 * Minimal wide-arithmetic kernels for comparing engine codegen, e.g. for a bug report.
 *
 * node scripts/bench/wide-kernels.ts
 *
 * Writes build/wide-kernels/kernels.wasm. Then time it and print machine code with
 * the engine-neutral harness, from identical bytes:
 *
 * node --wasm-wide-arithmetic --print-wasm-code --no-liftoff scripts/bench/wide-kernels-harness.js
 * js -m scripts/bench/wide-kernels-harness.js   (debug shell for disassembly)
 */
import fs from "node:fs";
import { Module, call, func, i32, i64, local, memory, $ } from "wasmati";
import { pallasParams } from "../../src/concrete/pasta.params.ts";
import { createField } from "../../src/wide/field-base.ts";
import { multiplyMontgomery } from "../../src/wide/multiply.ts";
import { forLoop1 } from "../../src/wasm/wasm-util.ts";

const F = createField(pallasParams.modulus);
const { multiply } = multiplyMontgomery(F);

const mulWide = func(
  { in: [{ a: i64 }, { b: i64 }], out: [i64, i64] },
  ({ a, b }) => {
    i64.mul_wide_u(a, b);
  },
);

const add128 = func(
  { in: [{ a: i64 }, { b: i64 }, { c: i64 }, { d: i64 }], out: [i64, i64] },
  ({ a, b, c, d }) => {
    i64.add128(a, b, c, d);
  },
);

// acc += a * (b + i) for i < n: throughput of independent mul_wide_u + add128
const macLoop = func(
  {
    in: [{ a: i64 }, { b: i64 }, { n: i32 }],
    locals: { lo: i64, hi: i64, pLo: i64, pHi: i64, i: i32 },
    out: [i64],
  },
  ({ a, b, n }, { lo, hi, pLo, pHi, i }) => {
    forLoop1(i, 0, n, () => {
      i64.mul_wide_u(a, i64.add(b, i64.extend_i32_u(i)));
      local.set(pHi, $);
      local.set(pLo, $);
      i64.add128(lo, hi, pLo, pHi);
      local.set(hi, $);
      local.set(lo, $);
    });
    i64.xor(lo, hi);
  },
);

// x <- x * x, n times: latency of the real Pallas Montgomery multiply
const multiplyLoop = func(
  { in: [{ x: i32 }, { n: i32 }], locals: { i: i32 }, out: [] },
  ({ x, n }, { i }) => {
    forLoop1(i, 0, n, () => call(multiply, { xy: x, x, y: x }));
  },
);

const wasmMemory = memory({ min: 1 });
const module = Module({
  memory: wasmMemory,
  exports: {
    memory: wasmMemory,
    mulWide,
    add128,
    macLoop,
    multiply,
    multiplyLoop,
  },
});
fs.mkdirSync("build/wide-kernels", { recursive: true });
fs.writeFileSync("build/wide-kernels/kernels.wasm", module.toBytes());
console.log("wrote build/wide-kernels/kernels.wasm");
