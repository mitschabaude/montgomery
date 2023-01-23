import { Binable, Empty } from "./binable.js";
import { I32 } from "./immediate.js";
import { i32, JSValue, ValueType } from "./types.js";

export { instructions };

let TODO = 0x99;

const instructions = {
  i32: {
    const: instruction(TODO, I32, [], [i32], (_c, x) => [x]),
    add: instruction(TODO, Empty, [i32, i32], [i32], (_c, _i, x, y) => [x + y]),
  },
};

type SimpleInstruction<I> = {
  code: number;
  immediate: Binable<I>;
  args: Tuple<ValueType>;
  results: Tuple<ValueType>;
  execute: (ctx: Context, immediate: I, ...args: any) => any[];
};

type Instruction = SimpleInstruction<any>;
type Context = { stack: ValueType[]; instructions: Instruction[] };

type Tuple<T> = [T, ...T[]] | [];
type JSValues<T extends Tuple<ValueType>> = {
  [i in keyof T]: JSValue<T[i]>;
};

function instruction<
  Arguments extends Tuple<ValueType>,
  Results extends Tuple<ValueType>,
  Immediate extends any
>(
  code: number,
  immediate: Binable<Immediate>,
  args: Arguments,
  results: Results,
  execute: (
    context: Context,
    immediate: Immediate,
    ...args: JSValues<Arguments>
  ) => JSValues<Results>
) {
  return ({ stack, instructions }: Context) => {
    apply(stack, args, results);
    instructions.push({ code, args, results, immediate, execute });
  };
}

function apply(stack: ValueType[], args: ValueType[], results: ValueType[]) {
  for (let arg of args) {
    if (stack.length === 0) {
      throw Error(`Stack is empty, tried to pop '${arg}'.`);
    }
    let stackArg = stack.pop();
    if (stackArg !== arg) {
      throw Error(
        `Last stack variable is '${stackArg}', tried to pop '${arg}'.`
      );
    }
  }
  for (let result of results) {
    stack.push(result);
  }
}
