import { Binable } from "../binable.js";
import { Instruction } from "./instruction.js";

export { Expression, ConstExpression };

/**
 * TODO: this file is pretty weird because it depends on ./instruction which depends on ./opcodes, but
 * Expression is actually used to define some opcodes in ./control
 *
 * It seems to break easily when moving stuff between files,
 * so should find a cleaner way w/o dependency cycles.
 */

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
