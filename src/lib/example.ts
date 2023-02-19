// import { exportFunction, importFunction } from "./export.js";
import { i32, local, ops } from "./instruction.js";
import assert from "node:assert";
import { emptyContext, func, Module } from "./under-construction.js";
import { Module as Module_ } from "./module.js";
import { importFunc } from "./export.js";

let ctx = emptyContext();

let consoleLog = importFunc(
  "console.log",
  { in: [i32], out: [] },
  (x: number) => console.log("logging from wasm:", x)
);

let myFunc = func(
  ctx,
  { in: { x: i32, y: i32 }, locals: {}, out: [i32] },
  ({ x, y }) => {
    i32.const(ctx, 0);
    local.get(ctx, x);
    i32.add(ctx);
    local.get(ctx, y);
    i32.add(ctx);
  }
);

let exportedFunc = func(
  ctx,
  { in: { x: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x }, { y }) => {
    local.get(ctx, x);
    ops.call(ctx, consoleLog);
    local.get(ctx, x);
    local.set(ctx, y);
    local.get(ctx, y);
    i32.const(ctx, 5);
    ops.call(ctx, myFunc);
    // ops.unreachable(ctx);
  }
);

let module: Module = Module({
  exports: { exportedFunc },
});

console.dir(module, { depth: 10 });
let wasmByteCode = Module_.toBytes(module);
console.log(`wasm size: ${wasmByteCode.length} byte`);
let recoveredModule = Module_.fromBytes(wasmByteCode);
assert.deepStrictEqual(recoveredModule, module);

let wasmModule = await WebAssembly.instantiate(Uint8Array.from(wasmByteCode), {
  env: { "console.log": (x: number) => console.log("logging from wasm:", x) },
});
console.log(wasmModule.instance.exports);
let { exportedFunc: exportedFunc_ } = wasmModule.instance.exports as any;
let result = exportedFunc_(10);
assert(result === 15);
console.log({ result });
