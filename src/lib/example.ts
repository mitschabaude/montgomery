import { global, i32, local, ops } from "./instruction/instruction.js";
import assert from "node:assert";
import { Module, func } from "./index.js";
import { importFunc } from "./export.js";
import { emptyContext } from "./local-context.js";
import { Const } from "./dependency.js";
import { funcref } from "./types.js";

let log = (...args: any) => console.log("logging from wasm:", ...args);

let consoleLog = importFunc({ in: [i32], out: [] }, log);
let consoleLogFunc = importFunc({ in: [funcref], out: [] }, log);

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

let funcGlobal = global(Const.refFunc(myFunc));

ctx = emptyContext();
let exportedFunc = func(
  ctx,
  { in: { x: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x }, { y }) => {
    global.get(ctx, funcGlobal);
    // ops.ref.func(ctx, myFunc); // TODO this fails, seems to be a spec bug
    ops.call(ctx, consoleLogFunc);
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

let module = Module({ exports: { exportedFunc } });

console.dir(module.module, { depth: 10 });

let wasmModule = await module.instantiate();
console.log(wasmModule.instance.exports);
let { exportedFunc: exportedFunc_ } = wasmModule.instance.exports;
let result = exportedFunc_(10);
assert(result === 15);
console.log({ result });

let wasmByteCode = Module.toBytes(module.module);
console.log(`wasm size: ${wasmByteCode.length} byte`);
let recoveredModule = Module.fromBytes(wasmByteCode);
assert.deepStrictEqual(recoveredModule, module.module);
