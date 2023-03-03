import { Binable } from "../binable.js";
import { Instruction } from "./instruction.js";

export { Expression, ConstExpression };

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
