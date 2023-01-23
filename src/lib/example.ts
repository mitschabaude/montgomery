import { func, FunctionContext } from "./function.js";
import { i32, local } from "./instruction.js";

let x = local("x", i32);
let y = local("y", i32);
let ctx: FunctionContext = {
  functions: [],
  instructions: [],
  locals: [],
  stack: [],
};

let myFunc = func(ctx, "myFunc", [x, y], [i32], [], ([x, y], []) => {
  i32.const(ctx, 0);
  local.get(ctx, x);
  i32.add(ctx, null);
});
