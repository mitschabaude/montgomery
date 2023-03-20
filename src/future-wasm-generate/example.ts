import {
  Module,
  func,
  control,
  i32,
  i64,
  local,
  global,
  ref,
  drop,
  select,
  funcref,
  importFunc,
  importGlobal,
  Memory,
  Table,
} from "./index.js";
import assert from "node:assert";
import fs from "node:fs";
import { Const } from "./dependency.js";
import Wabt from "wabt";
import { writeFile } from "../finite-field-compile.js";

const wabt = await Wabt();
const features = {
  multi_value: true,
  reference_types: true,
  mutable_globals: true,
  bulk_memory: true,
};

let log = (...args: any) => console.log("logging from wasm:", ...args);

let consoleLog = importFunc({ in: [i32], out: [] }, log);
let consoleLog64 = importFunc({ in: [i64], out: [] }, log);
let consoleLogFunc = importFunc({ in: [funcref], out: [] }, log);

let memory = Memory(
  { min: 1, max: 2 ** 16 },
  Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
);

let myFunc = func(
  { in: { x: i32, y: i32 }, locals: { tmp: i32, i: i32 }, out: [i32] },
  ({ x, y }, { tmp, i }, ctx) => {
    i32.const(0);
    local.get(x);
    i32.add();
    local.get(y);
    i32.add();
    control.block({ in: [i32], out: [i32] }, (block) => {
      local.tee(tmp);
      control.call(consoleLog);
      control.loop({}, () => {
        local.get(i);
        control.call(consoleLog);
        local.get(i);
        i32.const(1);
        i32.add();
        local.set(i);

        local.get(i);
        i32.const(5);
        i32.eq();
        control.if({}, () => {
          local.get(tmp);
          control.return();
          // fine that this is missing input, because code path is unreachable
          control.call(consoleLog);
        });
        control.br(0);
        // unreachable
        local.get(i);
        // i64.const(10n);
        i32.ne();
        control.br_if(0);
      });
      local.get(tmp);
      local.get(tmp);
      console.log(ctx.stack);
      drop();
      console.log(ctx.stack);
    });
  }
);

let importedGlobal = importGlobal(i64, 1000n);
let myFuncGlobal = global(Const.refFunc(myFunc));

let testUnreachable = func({ in: {}, locals: {}, out: [] }, () => {
  control.unreachable();
  // global.get(importedGlobal);
  i32.add();
  control.call(consoleLog);
});

let table = Table({ type: funcref, min: 4 }, [
  Const.refFunc(consoleLogFunc),
  Const.refFunc(myFunc),
  Const.refFuncNull,
  Const.refFuncNull,
]);

let exportedFunc = func(
  { in: { x: i32, doLog: i32 }, locals: { y: i32 }, out: [i32] },
  ({ x, doLog }, { y }) => {
    // control.call(testUnreachable);
    ref.func(myFunc); // TODO this fails if there is no table but a global, seems to be a V8 bug
    control.call(consoleLogFunc);
    global.get(myFuncGlobal);
    i32.const(0);
    control.call_indirect(table, { in: [funcref], out: [] });
    local.get(x);
    local.get(doLog);
    control.if(null, () => {
      local.get(x);
      control.call(consoleLog);
      // console.log({ stack: ctx.stack });
    });
    i32.const(2 ** 31 - 1);
    i32.const(-(2 ** 31));
    local.get(doLog);
    select();
    control.call(consoleLog);
    // drop();
    // local.get(x);
    local.set(y);
    local.get(y);
    i32.const(5);
    control.call(myFunc);
    // control.unreachable();
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
let recoveredModule = Module.fromBytes(wasmByteCode);
assert.deepStrictEqual(recoveredModule, module.module);

// write wat file for comparison
let wabtModule = wabt.readWasm(wasmByteCode, features);
let wat = wabtModule.toText({});
await writeFile(import.meta.url.slice(7).replace(".ts", ".wat"), wat);

// instantiate & run exported function
let wasmModule = await module.instantiate();
let { exports } = wasmModule.instance;
console.log(exports);
let result = exports.exportedFunc(10, 0);
assert(result === 15);
assert(exports.importedGlobal.value === 1000n);
console.log({ result, importedGlobal: exports.importedGlobal.value });
