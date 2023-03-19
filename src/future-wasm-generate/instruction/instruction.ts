import { localOps, globalOps, globalConstructor, refOps } from "./variable.js";
import { i32Ops, i64Ops } from "./int.js";
import { control as controlOps, parametric } from "./control.js";
import { Instruction } from "./binable.js";
import { resolveInstruction } from "./base.js";
import { emptyContext, LocalContext } from "../local-context.js";
import { Tuple } from "../util.js";
import { i32t, i64t, ValueTypeObject } from "../types.js";
import { func as originalFunc } from "../func.js";
export { Expression, ConstExpression } from "./binable.js";

// instruction API
export { i32, i64, f32, f64, local, global, ref, control, drop, select };

// other public API
export { func, defaultCtx };

// internal API
export { Instruction, resolveInstruction };

type i32 = "i32";
type i64 = "i64";
type f32 = "f32";
type f64 = "f64";

const defaultCtx = emptyContext();

const { func, i32, i64, local, global, ref, control, drop, select } =
  createInstructions(defaultCtx);

function createInstructions(ctx: LocalContext) {
  const func = removeContext(ctx, originalFunc);
  const i32 = Object.assign(i32t, removeContexts(ctx, i32Ops));
  const i64 = Object.assign(i64t, removeContexts(ctx, i64Ops));
  const local = removeContexts(ctx, localOps);
  const global = Object.assign(
    globalConstructor,
    removeContexts(ctx, globalOps)
  );
  const ref = removeContexts(ctx, refOps);
  const control = removeContexts(ctx, controlOps);
  const { drop, select_poly, select_t } = removeContexts(ctx, parametric);

  // wrappers for instructions that take optional arguments
  function select(t?: ValueTypeObject) {
    return t === undefined ? select_poly() : select_t(t);
  }

  return { func, i32, i64, local, global, ref, control, drop, select };
}

function removeContexts<
  T extends { [K in any]: (ctx: LocalContext, ...args: any) => any }
>(ctx: LocalContext, instructions: T): { [K in keyof T]: RemoveContext<T[K]> } {
  let result: {
    [K in keyof T]: RemoveContext<T[K]>;
  } = {} as any;
  for (let k in instructions) {
    result[k] = ((...args: any) => instructions[k](ctx, ...args)) as any;
  }
  return result;
}

type RemoveContext<F extends (ctx: LocalContext, ...args: any) => any> =
  F extends (ctx: LocalContext, ...args: infer Args) => infer Return
    ? (...args: Args) => Return
    : never;

function removeContext<Args extends Tuple<any>, Return extends any>(
  ctx: LocalContext,
  op: (ctx: LocalContext, ...args: Args) => Return
): (...args: Args) => Return {
  return (...args: Args) => op(ctx, ...args);
}
