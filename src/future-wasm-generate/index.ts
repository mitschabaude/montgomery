export { Module } from "./module.js";
import {
  localOps,
  globalOps,
  globalConstructor,
  refOps,
} from "./instruction/variable.js";
import { i32Ops, i64Ops } from "./instruction/int.js";
import { memoryOps } from "./instruction/memory.js";
import { control as controlOps, parametric } from "./instruction/control.js";
import { emptyContext, LocalContext } from "./local-context.js";
import { Tuple } from "./util.js";
import { i32t, i64t, v128t, ValueTypeObject } from "./types.js";
import { func as originalFunc } from "./func.js";
import { Instruction } from "./instruction/base.js";

// instruction API
export {
  i32,
  i64,
  f32,
  f64,
  v128,
  local,
  global,
  ref,
  control,
  drop,
  select,
  memory,
};

// other public API
export { func, defaultCtx };
export { funcref, externref, Type } from "./types.js";
export { importFunc, importGlobal } from "./export.js";
export { Memory, Data, Table, Elem } from "./memory.js";

type i32 = "i32";
type i64 = "i64";
type f32 = "f32";
type f64 = "f64";
type v128 = "v128";
const v128 = v128t;

const defaultCtx = emptyContext();

const { func, i32, i64, local, global, ref, control, drop, select, memory } =
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

  const memory = removeContexts(ctx, memoryOps);

  // wrappers for instructions that take optional arguments
  function select(t?: ValueTypeObject) {
    return t === undefined ? select_poly() : select_t(t);
  }

  return { func, i32, i64, local, global, ref, control, drop, select, memory };
}

function removeContexts<
  T extends {
    [K in any]: (ctx: LocalContext, ...args: any) => Instruction<any, any>;
  }
>(
  ctx: LocalContext,
  instructions: T
): {
  [K in keyof T]: RemoveContext<T[K]>;
} {
  let result: {
    [K in keyof T]: RemoveContext<T[K]>;
  } = {} as any;
  for (let k in instructions) {
    result[k] = ((...args: any) => instructions[k](ctx, ...args)) as any;
  }
  return result;
}

type RemoveContext<F extends (ctx: LocalContext, ...args: any) => any> =
  F extends (ctx: LocalContext, ...args: infer CreateArgs) => infer Return
    ? (...args: CreateArgs) => Return
    : never;

function removeContext<Args extends Tuple<any>, Return extends any>(
  ctx: LocalContext,
  op: (ctx: LocalContext, ...args: Args) => Return
): (...args: Args) => Return {
  return (...args: Args) => op(ctx, ...args);
}
