import * as Dependency from "./dependency.js";
import { ValueType } from "./types.js";

export {
  LocalContext,
  popStack,
  pushStack,
  pushInstruction,
  emptyContext,
  initializeContext,
};

type LocalContext = {
  // func: Dependency.Func; // inline / simplify like in the validation spec
  locals: ValueType[];
  deps: Dependency.t[];
  body: Dependency.Instruction[];
  stack: ValueType[];
  return: ValueType[]; // TODO
  // TODO blocks
};

function emptyContext(): LocalContext {
  return { locals: [], body: [], deps: [], return: [], stack: [] };
}

function initializeContext(
  ctx: LocalContext,
  locals: ValueType[],
  results: ValueType[]
) {
  ctx.locals = locals;
  ctx.return = results;
  ctx.body = [];
  ctx.deps = [];
  ctx.stack = [];
}

function pushInstruction(
  { stack, body, deps }: LocalContext,
  instr: Dependency.Instruction
) {
  popStack(stack, instr.type.args);
  pushStack(stack, instr.type.results);
  body.push(instr);
  for (let dep of instr.deps) {
    if (!deps.includes(dep)) {
      deps.push(dep);
    }
  }
}

function popStack(stack: ValueType[], values: ValueType[]) {
  // TODO nicer errors, which display entire stack vs entire instruction signature
  for (let value of values) {
    let stackValue = stack.pop();
    if (stackValue === undefined || value.kind !== stackValue.kind) {
      throw Error(
        `expected ${value.kind} on the stack, got ${
          stackValue?.kind ?? "nothing"
        }`
      );
    }
  }
}

function pushStack(stack: ValueType[], values: ValueType[]) {
  stack.push(...values);
}
