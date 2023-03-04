import * as Dependency from "./dependency.js";
import { InstructionName } from "./instruction/opcodes.js";
import { ValueType } from "./types.js";

export {
  LocalContext,
  popStack,
  pushStack,
  pushInstruction,
  emptyContext,
  withContext,
};

type Unknown = "unknown";

type ControlFrame = {
  opcode: InstructionName | "function" | "else";
  startTypes: ValueType[] | null;
  endTypes: ValueType[] | null;
  unreachable: boolean;
  stack: ValueType[];
};

type LocalContext = {
  locals: ValueType[];
  deps: Dependency.t[];
  body: Dependency.Instruction[];
  stack: ValueType[]; // === frames[0].stack
  frames: ControlFrame[];
  return: ValueType[] | null;
};

function emptyContext(): LocalContext {
  return {
    locals: [],
    body: [],
    deps: [],
    return: [],
    stack: [],
    frames: [],
  };
}

function withContext(
  ctx: LocalContext,
  override: Partial<LocalContext>,
  run: (ctx: LocalContext) => void
): LocalContext {
  let oldCtx = { ...ctx };
  Object.assign(ctx, override);
  if (ctx.frames.length === 0)
    throw Error("invariant violation: frames must not be empty");
  if (ctx.stack !== ctx.frames[0].stack)
    throw Error(
      "invariant violation: stack does not equal the stack on the current top frame"
    );
  let resultCtx: LocalContext;
  try {
    run(ctx);
    resultCtx = { ...ctx };
  } finally {
    Object.assign(ctx, oldCtx);
  }
  return resultCtx;
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
    if (stackValue === undefined || value !== stackValue) {
      throw Error(
        `expected ${value} on the stack, got ${stackValue ?? "nothing"}`
      );
    }
  }
}

function pushStack(stack: ValueType[], values: ValueType[]) {
  stack.push(...values);
}
