import * as Dependency from "./dependency.js";
import { FunctionType, ValueType } from "./types.js";

type InstructionApplied = {
  deps: Dependency.t[];
  type: FunctionType;
};

type LocalContext = {
  func: Dependency.Func; // inline / simplify like in the validation spec
  stack: ValueType[];
  // TODO blocks
};

function emptyFunc(
  args: ValueType[],
  results: ValueType[],
  locals: ValueType[]
): Dependency.Func {
  return {
    kind: "function",
    type: { args, results },
    locals,
    body: [],
    deps: [],
  };
}

function addInstruction(ctx: LocalContext, instr: InstructionApplied) {}

function apply(stack: ValueType[], { args, results }: FunctionType) {
  // TODO nicer errors, which display entire stack vs entire instruction signature
  for (let arg of args) {
    let stackArg = stack.pop()!;
    if (arg.kind !== stackArg.kind) {
      throw Error(`expected ${arg.kind} on the stack, got ${stackArg.kind}`);
    }
  }
  for (let result of results) {
    stack.push(result);
  }
}
