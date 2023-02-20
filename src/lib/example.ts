import { i32, local, ops } from "./instruction/instruction.js";
import assert from "node:assert";
import { Module, func } from "./index.js";
import { importFunc } from "./export.js";
import { emptyContext } from "./local-context.js";
import { Const } from "./dependency.js";
import { global } from "./memory.js";
import { externref } from "./types.js";

let log = (x: any) => console.log("logging from wasm:", x);
let consoleLog = importFunc("console.log", { in: [i32], out: [] }, log);
let consoleLogExtern = importFunc(
  "console.log",
  { in: [externref], out: [] },
  log
);

let nullGlobal = global(Const.refExternNull);

let ctx = emptyContext();
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

ctx = emptyContext();
let exportedFunc = func(
  ctx,
  { in: { x: i32, z: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x, z }, { y }) => {
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

let module = Module({
  exports: { exportedFunc },
});

console.dir(module.module, { depth: 10 });

let wasmModule = await module.instantiate();
console.log(wasmModule.instance.exports);
let { exportedFunc: exportedFunc_ } = wasmModule.instance.exports;
let result = exportedFunc_(10, 1);
assert(result === 15);
console.log({ result });

let wasmByteCode = Module.toBytes(module.module);
console.log(`wasm size: ${wasmByteCode.length} byte`);
let recoveredModule = Module.fromBytes(wasmByteCode);
assert.deepStrictEqual(recoveredModule, module.module);
