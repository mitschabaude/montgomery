import { Binable, iso, named, One, record } from "./binable.js";
import { I32, U32 } from "./immediate.js";
import {
  i32t,
  i64t,
  f32t,
  f64t,
  JSValue,
  ValueType,
  ValueTypeLiteral,
  valueType,
} from "./types.js";

export {
  ops,
  i32,
  local,
  Instruction,
  Expression,
  Context,
  Local,
  ConcreteLocal,
  ToLocal,
  popValue,
};

let FunctionIndex = <B extends boolean>({ needsShift }: { needsShift: B }) =>
  iso<number, { functionIndex: number; needsShift: B }>(U32, {
    to: ({ functionIndex }) => functionIndex,
    from: (functionIndex) => ({ functionIndex, needsShift }),
  });
let RawFunctionIndex = FunctionIndex({ needsShift: false });
let ShiftedFunctionIndex = FunctionIndex({ needsShift: true });

// control
let unreachable = baseInstruction("unreachable", One);
let call = baseInstruction("call", U32);
let control = { unreachable, call };

// variable
type Local<T extends ValueType> = { name: string; type: T };
type ToLocal<T extends ValueType> = T extends i32
  ? Local<i32>
  : T extends i64
  ? Local<i64>
  : T extends f32
  ? Local<f32>
  : T extends f64
  ? Local<f64>
  : Local<T>;

type ConcreteLocal = { index: number };
const ConcreteLocal = named({ index: U32 });

let local_ = {
  get: baseInstruction("local.get", ConcreteLocal, ({ stack, locals }, x) => {
    let local = locals[x.index];
    if (local === undefined) throw Error(`local with index ${x} not available`);
    stack.push(local.type);
  }),
  set: baseInstruction("local.set", ConcreteLocal, ({ stack, locals }, x) => {
    let local = locals[x.index];
    if (local === undefined) throw Error(`local with index ${x} not available`);
    popValue(stack, local.type);
  }),
};
const local = Object.assign(function local<L extends ValueTypeLiteral>(
  string: string,
  type: { kind: L }
): ToLocal<{ kind: L }> {
  return { string, type: valueType(type.kind) } as any;
},
local_);

type i32 = i32t;
type i64 = i64t;
type f32 = f32t;
type f64 = f64t;
const i32 = Object.assign(i32t, {
  const: instruction("i32.const", I32, [], [i32t], (_c, i) => [i]),
  add: instruction("i32.add", One, [i32t, i32t], [i32t], (_c, _i, x, y) => [
    x + y,
  ]),
});

const ops = { i32, local, ...control };

const opcodes: Record<number, BaseInstruction> = {
  // control
  0x00: unreachable,
  0x10: call,

  // numeric
  0x41: i32.const,

  0x6a: i32.add,

  // variable
  0x20: local.get,
  0x21: local.set,
};

const instructionToOpcode = invertOpcodes();

type BaseInstruction = { string: string; immediate: Binable<any> | undefined };

function baseInstruction<Immediate>(
  string: string,
  immediate: Binable<Immediate> | undefined = undefined,
  validate?: (context: Context, immediate: Immediate) => void
) {
  let instruction = { string, immediate };
  function i(ctx: Context, immediate: Immediate) {
    validate?.(ctx, immediate);
    ctx.instructions.push({ string, immediate });
  }
  return Object.assign(i, instruction);
}

function instruction<
  Arguments extends Tuple<ValueType>,
  Results extends Tuple<ValueType>,
  Immediate extends any
>(
  string: string,
  immediate: Binable<Immediate> | undefined,
  args: Arguments,
  results: Results,
  execute: (
    context: Context,
    immediate: Immediate,
    ...args: JSValues<Arguments>
  ) => JSValues<Results>
) {
  immediate = immediate === One ? undefined : immediate;
  type InstArgs = Immediate extends undefined
    ? [context: Context]
    : [context: Context, immediate: Immediate];
  let instruction_ = Object.assign(
    function (...[{ stack, instructions }, immediate]: InstArgs) {
      apply(stack, args, results);
      instructions.push({ string, immediate });
    },
    { string, args, results, immediate, execute }
  );
  return instruction_;
}

type SimpleInstruction<I> = { string: string; immediate: I };
type Instruction = SimpleInstruction<any>;
const Instruction = Binable<Instruction>({
  toBytes(instr) {
    let opcode = instructionToOpcode[instr.string];
    if (opcode === undefined) throw Error("invalid instruction name");
    let instrObject = opcodes[opcode];
    let imm: number[] = [];
    if (instrObject.immediate !== undefined) {
      imm = instrObject.immediate.toBytes(instr.immediate);
    }
    return [opcode, ...imm];
  },
  readBytes(bytes, offset) {
    let opcode: number = bytes[offset++];
    let instr = opcodes[opcode];
    if (instr === undefined) throw Error("invalid opcode");
    if (instr.immediate === undefined)
      return [{ string: instr.string, immediate: undefined }, offset];
    let [immediate, end] = instr.immediate.readBytes(bytes, offset);
    return [{ string: instr.string, immediate }, end];
  },
});

type Expression = Instruction[];
const END = 0x0b;
const Expression = Binable<Expression>({
  toBytes(t) {
    let instructions = t.map((i) => Instruction.toBytes(i)).flat();
    instructions.push(END);
    return instructions;
  },
  readBytes(bytes, offset) {
    let instructions: Instruction[] = [];
    while (bytes[offset] !== END) {
      let instr: Instruction;
      [instr, offset] = Instruction.readBytes(bytes, offset);
      instructions.push(instr);
    }
    return [instructions, offset + 1];
  },
});

function apply(stack: ValueType[], args: ValueType[], results: ValueType[]) {
  for (let arg of args) {
    if (stack.length === 0) {
      throw Error(`Stack is empty, tried to pop '${arg.kind}'.`);
    }
    let stackArg = stack.pop();
    if (stackArg!.kind !== arg.kind) {
      throw Error(
        `Last stack variable is '${stackArg?.kind}', tried to pop '${arg.kind}'.`
      );
    }
  }
  for (let result of results) {
    stack.push(result);
  }
}

function invertOpcodes() {
  let map: Record<string, number> = {};
  type K = keyof typeof opcodes;
  for (let key in opcodes) {
    let code = Number(key);
    let instruction = opcodes[code as K];
    map[instruction.string] = code;
  }
  return map;
}

function popValue(stack: ValueType[], expected: ValueType) {
  let stackVar = stack.pop();
  if (stackVar?.kind !== expected.kind) {
    return false;
  }
  return true;
}

type Context = {
  stack: ValueType[];
  instructions: Instruction[];
  locals: Local<any>[];
};

type Tuple<T> = [T, ...T[]] | [];
type JSValues<T extends Tuple<ValueType>> = {
  [i in keyof T]: JSValue<T[i]>;
};
