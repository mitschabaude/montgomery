import { Binable } from "./binable.js";
import * as Dependency from "./dependency.js";
import { local } from "./instruction-local.js";
import { i32, i64 } from "./instruction-int.js";
import { control } from "./instruction-control.js";
import { opcodes, instructionToOpcode } from "./instruction-opcodes.js";

export { ops, i32, i64, local };
export { Instruction, Expression, ConstExpression, resolveInstruction };

const ops = { i32, local, ...control };

function resolveInstruction(
  { string, deps, resolveArgs }: Dependency.Instruction,
  depToIndex: Map<Dependency.t, number>
): Instruction {
  let opcode = instructionToOpcode[string];
  if (opcode === undefined) throw Error("invalid instruction name");
  let instrObject = opcodes[opcode];
  let depIndices: number[] = [];
  for (let dep of deps) {
    let index = depToIndex.get(dep);
    if (index === undefined) throw Error("bug: no index for dependecy");
    depIndices.push(index);
  }
  let immediate = instrObject.resolve(depIndices, ...resolveArgs);
  return { string, immediate };
}

type Instruction = { string: string; immediate: any };

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
    let instructions = t.map(Instruction.toBytes).flat();
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

// TODO validation
type ConstExpression = Expression;
const ConstExpression = Expression;
