import { func, FunctionContext } from "./function.js";
import { i32, local, ops } from "./instruction.js";
import { Module } from "./module.js";

let x = local("x", i32);
let y = local("y", i32);
let ctx: FunctionContext = {
  functions: [],
  instructions: [],
  locals: [],
  stack: [],
};

let myFunc = func(
  ctx,
  "myFunc",
  { args: [x, y], locals: [], results: [i32] },
  ([x, y]) => {
    i32.const(ctx, 0);
    local.get(ctx, x);
    i32.add(ctx, undefined);
    local.get(ctx, y);
    i32.add(ctx, undefined);
  }
);

let exportedFunc = func(
  ctx,
  "exportedFunc",
  { args: [], locals: [x], results: [] },
  (_, [x]) => {
    i32.const(ctx, 5);
    local.get(ctx, x);
    myFunc();
    local.set(ctx, x);
    // ops.unreachable(ctx, undefined);
  }
);

let module: Module = {
  functions: ctx.functions,
  start: ctx.functions[1],
};

console.dir(module, { depth: 10 });
let wasmByteCode = Module.toBytes(module);
console.log(wasmByteCode);
console.dir(Module.fromBytes(wasmByteCode), { depth: 10 });

let wasmModule = await WebAssembly.instantiate(Uint8Array.from(wasmByteCode));
console.log(wasmModule.instance);
console.log(wasmModule.instance.exports);
