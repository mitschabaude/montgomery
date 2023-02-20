import { Binable, iso, record, tuple } from "./binable.js";
import * as Dependency from "./dependency.js";
import { U32, vec, withByteLength } from "./immediate.js";
import { Expression, Instruction, ToValueType } from "./instruction.js";
import { initializeContext, LocalContext, popStack } from "./local-context.js";
import {
  FunctionIndex,
  FunctionType,
  TypeIndex,
  valueType,
  ValueType,
  ValueTypeLiteral,
} from "./types.js";

// external
export { func };
// internal
export { Dependency, Func, Code };

function func<
  Args extends Record<string, ValueType>,
  Locals extends Record<string, ValueType>,
  Results extends ValueType[]
>(
  ctx: LocalContext,
  {
    in: args,
    locals,
    out: results,
  }: {
    in: Args;
    locals: Locals;
    out: Results;
  },
  run: (args: ToLocal<Args>, locals: ToLocal<Locals>) => void
): Dependency.Func {
  ctx.stack = [];
  let argsArray = Object.values(args).map((arg) => valueType(arg.kind));
  let localsArray = Object.values(locals).map((arg) => valueType(arg.kind));
  let resultsArray = results.map((arg) => valueType(arg.kind));
  let type = { args: argsArray, results: resultsArray };
  initializeContext(ctx, [...argsArray, ...localsArray], resultsArray);
  let nArgs = argsArray.length;
  let argsInput = Object.fromEntries(
    Object.entries(args).map(([key], index) => [key, { index }])
  ) as ToLocal<Args>;
  let localsInput = Object.fromEntries(
    Object.entries(locals).map(([key], index) => [
      key,
      { index: index + nArgs },
    ])
  ) as ToLocal<Locals>;
  run(argsInput, localsInput);
  popStack(ctx.stack, results);
  // TODO nice error
  if (ctx.stack.length !== 0) throw Error("expected stack to be empty");
  let { body, deps } = ctx;
  initializeContext(ctx, [], []);
  return { kind: "function", type, body, deps, locals: localsArray };
}

type ToLocal<T extends Record<string, ValueType>> = {
  [K in keyof T]: { type?: ToValueType<T[K]>; index: number };
};

type Func = {
  functionIndex: FunctionIndex;
  typeIndex: TypeIndex;
  type: FunctionType;
  locals: ValueType[];
  body: Instruction[];
};

// binable

const CompressedLocals = vec(tuple([U32, ValueType]));
const Locals = iso<[number, ValueType][], ValueType[]>(CompressedLocals, {
  to(locals) {
    let count: Record<string, number> = {};
    for (let local of locals) {
      count[local.kind] ??= 0;
      count[local.kind]++;
    }
    return Object.entries(count).map(([kind, count]) => [
      count,
      valueType(kind as ValueTypeLiteral),
    ]);
  },
  from(compressed) {
    let locals: ValueType[] = [];
    for (let [count, local] of compressed) {
      locals.push(...Array(count).fill(local));
    }
    return locals;
  },
});

type Code = { locals: ValueType[]; body: Expression };
const Code = withByteLength(
  record({ locals: Locals, body: Expression })
) satisfies Binable<Code>;
