import { Tuple } from "./binable.js";
import { Context, Expression, Local, ops, popValue } from "./instruction.js";
import { FunctionType, ValueType } from "./types.js";

export { func, FunctionContext };

type Func = {
  index: number;
  type: FunctionType;
  locals: ValueType[];
  expression: Expression;
};
type FunctionContext = {
  functions: Func[];
} & Context;

function func<
  Arguments extends Tuple<Local<ValueType>>,
  Locals extends Tuple<Local<ValueType>>
>(
  ctx: FunctionContext,
  name: string,
  args: Arguments,
  results: ValueType[],
  locals: Locals,
  // TODO: make this a nice record with the extended mapping syntax
  run: (args: ToConcrete<Arguments>, locals: ToConcrete<Locals>) => void
) {
  let {
    stack: oldStack,
    instructions: oldInstructions,
    locals: oldLocals,
  } = ctx;
  ctx.instructions = [];
  ctx.stack = [];
  let concreteArgs = args.map((arg, i) => ({
    ...arg,
    index: i,
  })) as ToConcrete<Arguments>;
  let concreteLocals = locals.map((local, i) => ({
    ...local,
    index: i + args.length,
  })) as ToConcrete<Locals>;
  ctx.locals = [...concreteArgs, ...concreteLocals];
  run(concreteArgs, concreteLocals);
  let { stack, instructions } = ctx;
  let n = stack.length;
  if (n !== results.length) {
    throw Error(
      `${name}: expected ${results.length} return arguments, got ${n}.`
    );
  }
  stack.reverse();
  let ok = stack.every((s, i) => results[i].kind === s.kind);
  if (!ok)
    throw Error(`${name}: Expected return types [${results}], got [${stack}]`);
  let index = ctx.functions.length;
  let funcObj: Func = {
    index,
    type: { args: args.map((a) => a.type), results },
    expression: instructions,
    locals: locals.map((l) => l.type),
  };
  ctx.functions.push(funcObj);
  ctx.stack = oldStack;
  ctx.instructions = oldInstructions;
  ctx.locals = oldLocals;

  return function call() {
    let { stack } = ctx;
    let n = args.length;
    if (stack.length < n) {
      throw Error(
        `${name}: expected ${args.length} input arguments, but only ${n} elements on the stack.`
      );
    }
    let ok = true;
    let oldStack = [...stack];
    for (let arg of [...args].reverse()) {
      ok &&= popValue(stack, arg.type);
    }
    if (!ok) {
      throw Error(
        `${name}: Expected input types [${args}], got stack [${oldStack}]`
      );
    }
    ops.call(ctx, index);
    // TODO: is this the right order?
    for (let result of results) {
      stack.push(result);
    }
  };
}

type ToConcrete<T extends Tuple<Local<any>>> = {
  [i in keyof T]: { name: T[i]["name"]; type: T[i]["type"]; index: number };
} & any[];

// type RecordFromLocals<T extends Tuple<Local>> =
// { [i in keyof T as T[i]['name']]: T[i]['type'] }
