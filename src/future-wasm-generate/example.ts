import { control, global, i32, local } from "./instruction/instruction.js";
import assert from "node:assert";
import { Module, func } from "./index.js";
import { importFunc, importGlobal } from "./export.js";
import { emptyContext, LocalContext } from "./local-context.js";
import { Const } from "./dependency.js";
import { funcref, i64t } from "./types.js";

let log = (...args: any) => console.log("logging from wasm:", ...args);

let consoleLog = importFunc({ in: [i32], out: [] }, log);
let consoleLog64 = importFunc({ in: [i64t], out: [] }, log);
let consoleLogFunc = importFunc({ in: [funcref], out: [] }, log);

let ctx: LocalContext;

ctx = emptyContext();
let myFunc = func(
  ctx,
  { in: { x: i32, y: i32 }, locals: { tmp: i32 }, out: [i32] },
  ({ x, y }, { tmp }) => {
    i32.const(ctx, 0);
    local.get(ctx, x);
    i32.add(ctx);
    local.get(ctx, y);
    i32.add(ctx);
    control.block(ctx, () => {
      local.tee(ctx, tmp);
      control.call(ctx, consoleLog);
      local.get(ctx, tmp);
    });
  }
);

let importedGlobal = importGlobal(i64t, 1000n);
let funcGlobal = global(Const.refFunc(myFunc));

ctx = emptyContext();
let exportedFunc = func(
  ctx,
  { in: { x: i32, doLog: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x, doLog }, { y }) => {
    global.get(ctx, funcGlobal);
    // ref.func(ctx, myFunc); // TODO this fails, seems to be a spec bug
    control.call(ctx, consoleLogFunc);
    local.get(ctx, x);
    local.get(ctx, doLog);
    control.if(ctx, () => {
      local.get(ctx, x);
      control.call(ctx, consoleLog);
      // console.log({ stack: ctx.stack });
    });
    // local.get(ctx, x);
    local.set(ctx, y);
    local.get(ctx, y);
    i32.const(ctx, 5);
    control.call(ctx, myFunc);
    // control.unreachable(ctx);
  }
);

let module = Module({ exports: { exportedFunc, importedGlobal } });

console.dir(module.module, { depth: 10 });

let wasmModule = await module.instantiate();
let { exports } = wasmModule.instance;
console.log(exports);
let result = exports.exportedFunc(10, 0);
assert(result === 15);
assert(exports.importedGlobal.value === 1000n);
console.log({ result, importedGlobal: exports.importedGlobal.value });

let wasmByteCode = Module.toBytes(module.module);
console.log(`wasm size: ${wasmByteCode.length} byte`);
let recoveredModule = Module.fromBytes(wasmByteCode);
assert.deepStrictEqual(recoveredModule, module.module);
