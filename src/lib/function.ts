import { Binable, iso, record, tuple, Tuple } from "./binable.js";
import { U32, vec, withByteLength } from "./immediate.js";
import { Context, Expression, Local, ops, popValue } from "./instruction.js";
import {
  FunctionType,
  valueType,
  ValueType,
  ValueTypeLiteral,
} from "./types.js";

export { func, Func, FunctionContext, Code };

type Func = {
  index: number;
  type: FunctionType;
  locals: ValueType[];
  body: Expression;
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
  {
    args,
    locals,
    results,
  }: { args: Arguments; locals: Locals; results: ValueType[] },
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
  let concreteArgs = args.map((_, i) => ({
    index: i,
  })) as ToConcrete<Arguments>;
  let concreteLocals = locals.map((_, i) => ({
    index: i + args.length,
  })) as ToConcrete<Locals>;
  ctx.locals = [...args, ...locals];
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
    throw Error(
      `${name}: Expected return types [${results.map(
        (r) => r.kind
      )}], got [${stack.map((s) => s.kind)}]`
    );
  let index = ctx.functions.length;
  let funcObj: Func = {
    index,
    type: { args: args.map((a) => a.type), results },
    body: instructions,
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
        `${name}: Expected input types [${args.map(
          (a) => a.type.kind
        )}], got stack [${oldStack.map((s) => s.kind)}]`
      );
    }
    ops.call(ctx, index);
    // TODO: is this the right order?
    for (let result of results) {
      stack.push(result);
    }
  };
}

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
  record({ locals: Locals, body: Expression }, ["locals", "body"])
) satisfies Binable<Code>;

type ToConcrete<T extends Tuple<Local<any>>> = {
  [i in keyof T]: { index: number };
} & any[];

// type RecordFromLocals<T extends Tuple<Local>> =
// { [i in keyof T as T[i]['name']]: T[i]['type'] }
