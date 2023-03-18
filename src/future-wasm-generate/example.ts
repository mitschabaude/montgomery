import { control, global, i32, i64, local } from "./instruction/instruction.js";
import assert from "node:assert";
import fs from "node:fs";
import { Module, func } from "./index.js";
import { importFunc, importGlobal } from "./export.js";
import { emptyContext, LocalContext } from "./local-context.js";
import { Const } from "./dependency.js";
import { funcref, i64t } from "./types.js";
import { Memory, Table } from "./memory.js";
import Wabt from "wabt";
import { writeFile } from "../finite-field-compile.js";
import { ref } from "./instruction/variable.js";
import { drop, select } from "./instruction/control.js";

const wabt = await Wabt();
const features = {
  multi_value: true,
  reference_types: true,
  mutable_globals: true,
  bulk_memory: true,
};

let log = (...args: any) => console.log("logging from wasm:", ...args);

let consoleLog = importFunc({ in: [i32], out: [] }, log);
let consoleLog64 = importFunc({ in: [i64t], out: [] }, log);
let consoleLogFunc = importFunc({ in: [funcref], out: [] }, log);

let memory = Memory(
  { min: 1, max: 2 ** 16 },
  Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
);

let ctx: LocalContext;

ctx = emptyContext();

let myFunc = func(
  ctx,
  { in: { x: i32, y: i32 }, locals: { tmp: i32, i: i32 }, out: [i32] },
  ({ x, y }, { tmp, i }) => {
    i32.const(ctx, 0);
    local.get(ctx, x);
    i32.add(ctx);
    local.get(ctx, y);
    i32.add(ctx);
    control.block(ctx, { in: [i32], out: [i32] }, (block) => {
      local.tee(ctx, tmp);
      control.call(ctx, consoleLog);
      control.loop(ctx, {}, () => {
        local.get(ctx, i);
        control.call(ctx, consoleLog);
        local.get(ctx, i);
        i32.const(ctx, 1);
        i32.add(ctx);
        local.set(ctx, i);

        local.get(ctx, i);
        i32.const(ctx, 5);
        i32.eq(ctx);
        control.if(ctx, {}, () => {
          local.get(ctx, tmp);
          control.return(ctx);
          // fine that this is missing input, because code path is unreachable
          control.call(ctx, consoleLog);
        });
        control.br(ctx, 0);
        // unreachable
        local.get(ctx, i);
        // i64.const(ctx, 10n);
        i32.ne(ctx);
        control.br_if(ctx, 0);
      });
      local.get(ctx, tmp);
      local.get(ctx, tmp);
      console.log(ctx.stack);
      drop(ctx);
      console.log(ctx.stack);
    });
  }
);

let importedGlobal = importGlobal(i64t, 1000n);
let myFuncGlobal = global(Const.refFunc(myFunc));

let testUnreachable = func(ctx, { in: {}, locals: {}, out: [] }, () => {
  control.unreachable(ctx);
  // global.get(ctx, importedGlobal);
  i32.add(ctx);
  control.call(ctx, consoleLog);
});

let table = Table({ type: funcref, min: 4 }, [
  Const.refFunc(consoleLogFunc),
  Const.refFunc(myFunc),
  Const.refFuncNull,
  Const.refFuncNull,
]);

let exportedFunc = func(
  ctx,
  { in: { x: i32, doLog: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x, doLog }, { y }) => {
    // control.call(ctx, testUnreachable);
    ref.func(ctx, myFunc); // TODO this fails if there is no table but a global, seems to be a V8 bug
    control.call(ctx, consoleLogFunc);
    global.get(ctx, myFuncGlobal);
    i32.const(ctx, 0);
    control.call_indirect(ctx, table, { in: [funcref], out: [] });
    local.get(ctx, x);
    local.get(ctx, doLog);
    control.if(ctx, null, () => {
      local.get(ctx, x);
      control.call(ctx, consoleLog);
      // console.log({ stack: ctx.stack });
    });
    i32.const(ctx, 2 ** 31 - 1);
    i32.const(ctx, -(2 ** 31));
    local.get(ctx, doLog);
    select(ctx);
    control.call(ctx, consoleLog);
    // drop(ctx);
    // local.get(ctx, x);
    local.set(ctx, y);
    local.get(ctx, y);
    i32.const(ctx, 5);
    control.call(ctx, myFunc);
    // control.unreachable(ctx);
  }
);

let module = Module({
  exports: { exportedFunc, importedGlobal },
  memory,
});

console.dir(module.module, { depth: Infinity });

// create byte code and check roundtrip
let wasmByteCode = module.toBytes();
console.log(`wasm size: ${wasmByteCode.length} byte`);
// let recoveredModule = Module.fromBytes(wasmByteCode);
// assert.deepStrictEqual(recoveredModule, module.module);

// write wat file for comparison
let wabtModule = wabt.readWasm(wasmByteCode, features);
let wat = wabtModule.toText({});
await writeFile("src/future-wasm-generate/example.wat", wat);

// instantiate & run exported function
let wasmModule = await module.instantiate();
let { exports } = wasmModule.instance;
console.log(exports);
let result = exports.exportedFunc(10, 0);
assert(result === 15);
assert(exports.importedGlobal.value === 1000n);
console.log({ result, importedGlobal: exports.importedGlobal.value });
