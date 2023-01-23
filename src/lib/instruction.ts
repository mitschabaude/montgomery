import { Binable, Empty } from "./binable.js";
import { I32 } from "./immediate.js";
import { i32t, JSValue, ValueType } from "./types.js";

export { Instruction, Expression };

// control instructions
let unreachable = instruction("unreachable", Empty, [], [], () => {
  throw Error("unreachable");
});

const i32 = {
  const: instruction("i32.const", I32, [], [i32t], (_c, i) => [i]),
  add: instruction("i32.add", Empty, [i32t, i32t], [i32t], (_c, _i, x, y) => [
    x + y,
  ]),
};

const opcodes: Record<number, InstructionObject> = {
  // control
  0x00: unreachable,

  // numeric
  0x41: i32.const,

  0x6a: i32.add,
};

const instructionToOpcode = invertOpcodes();

function instruction<
  Arguments extends Tuple<ValueType>,
  Results extends Tuple<ValueType>,
  Immediate extends any
>(
  name: string,
  immediate: Binable<Immediate> | null,
  args: Arguments,
  results: Results,
  execute: (
    context: Context,
    immediate: Immediate,
    ...args: JSValues<Arguments>
  ) => JSValues<Results>
) {
  immediate = immediate === Empty ? null : immediate;
  let instruction_ = Object.assign(
    function ({ stack, instructions }: Context) {
      apply(stack, args, results);
      instructions.push(instruction_);
    },
    { name, args, results, immediate, execute }
  );
  return instruction_;
}

type SimpleInstruction<I> = { name: string; immediate: I };
type Instruction = SimpleInstruction<any>;
const Instruction = Binable<Instruction>({
  toBytes(instr) {
    let opcode = instructionToOpcode[instr.name];
    if (opcode === undefined) throw Error("invalid instruction name");
    let instrObject = opcodes[opcode];
    let imm: number[] = [];
    if (instrObject.immediate !== null) {
      imm = instrObject.immediate.toBytes(instr.immediate);
    }
    return [opcode, ...imm];
  },
  readBytes(bytes, offset) {
    let opcode = bytes[offset++];
    let instr = opcodes[opcode];
    if (instr === undefined) throw Error("invalid opcode");
    if (instr.immediate === null)
      return [{ name: instr.name, immediate: null }, offset];
    let [immediate, end] = instr.immediate.readBytes(bytes, offset);
    return [{ name: instr.name, immediate }, end];
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
    return [instructions, offset++];
  },
});

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

function invertOpcodes() {
  let map: Record<string, number> = {};
  type K = keyof typeof opcodes;
  for (let key in opcodes) {
    let code = Number(key);
    let instruction = opcodes[code as K];
    map[instruction.name] = code;
  }
  return map;
}

type Context = { stack: ValueType[]; instructions: Instruction[] };

type Tuple<T> = [T, ...T[]] | [];
type JSValues<T extends Tuple<ValueType>> = {
  [i in keyof T]: JSValue<T[i]>;
};

type InstructionObject = {
  name: string;
  immediate: Binable<any> | null;
  args: Tuple<ValueType>;
  results: Tuple<ValueType>;
};
