import { func, FunctionContext } from "./function.js";
import { Expression, i32, local } from "./instruction.js";

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
    i32.add(ctx, null);
    local.get(ctx, y);
    i32.add(ctx, null);
  }
);

let exportedFunc = func(
  ctx,
  "exportedFunc",
  { args: [], locals: [x], results: [i32] },
  (_, [x]) => {
    i32.const(ctx, 5);
    local.get(ctx, x);
    myFunc();
  }
);

let bytes = Expression.toBytes(ctx.functions[0].expression);
console.log(bytes);
let e = Expression.fromBytes(bytes);

console.dir(ctx, { depth: Infinity });
