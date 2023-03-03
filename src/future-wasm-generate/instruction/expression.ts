import { Binable } from "../binable.js";
import { lookupInstruction, lookupOpcode } from "./base.js";

export { Instruction, Expression, ConstExpression };

type Instruction = { string: string; immediate: any };

const Instruction = Binable<Instruction>({
  toBytes({ string, immediate }) {
    let instr = lookupInstruction(string);
    let imm: number[] = [];
    if (instr.immediate !== undefined) {
      imm = instr.immediate.toBytes(immediate);
    }
    return [instr.opcode, ...imm];
  },
  readBytes(bytes, offset) {
    let opcode: number = bytes[offset++];
    let instr = lookupOpcode(opcode);
    if (instr === undefined) throw Error(`invalid opcode ${opcode}`);
    if (instr.immediate === undefined)
      return [{ string: instr.string, immediate: undefined }, offset];
    let [immediate, end] = instr.immediate.readBytes(bytes, offset);
    return [{ string: instr.string, immediate }, end];
  },
});

const END = 0x0b;
type Expression = Instruction[];
const Expression = Binable<Instruction[]>({
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

type ConstExpression = Expression;
const ConstExpression = Expression;
