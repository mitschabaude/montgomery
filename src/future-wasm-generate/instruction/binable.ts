import { Binable, constant, or, record, withByteCode } from "../binable.js";
import { S33, U32 } from "../immediate.js";
import { ValueType } from "../types.js";
import { lookupInstruction, lookupOpcode } from "./base.js";

export { FinalizedInstruction, Expression, ConstExpression, Block, IfBlock };

type FinalizedInstruction = { string: string; immediate: any };

const Instruction = Binable<FinalizedInstruction>({
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
type Expression = FinalizedInstruction[];
const Expression = Binable<FinalizedInstruction[]>({
  toBytes(t) {
    let instructions = t.map(Instruction.toBytes).flat();
    instructions.push(END);
    return instructions;
  },
  readBytes(bytes, offset) {
    let instructions: FinalizedInstruction[] = [];
    while (bytes[offset] !== END) {
      let instr: FinalizedInstruction;
      [instr, offset] = Instruction.readBytes(bytes, offset);
      instructions.push(instr);
    }
    return [instructions, offset + 1];
  },
});

const ELSE = 0x05;
type IfExpression = {
  if: FinalizedInstruction[];
  else?: FinalizedInstruction[];
};
const IfExpression = Binable<IfExpression>({
  toBytes(t) {
    let instructions = t.if.map(Instruction.toBytes).flat();
    if (t.else !== undefined) {
      instructions.push(ELSE, ...t.else.map(Instruction.toBytes).flat());
    }
    instructions.push(END);
    return instructions;
  },
  readBytes(bytes, offset) {
    let t: IfExpression = { if: [], else: undefined };
    let instructions = t.if;
    while (true) {
      if (bytes[offset] === ELSE) {
        instructions = t.else = [];
        offset++;
        continue;
      } else if (bytes[offset] === END) {
        offset++;
        break;
      }
      let instr: FinalizedInstruction;
      [instr, offset] = Instruction.readBytes(bytes, offset);
      instructions.push(instr);
    }
    return [t, offset];
  },
});

type ConstExpression = Expression;
const ConstExpression = Expression;

const Empty = withByteCode(0x40, constant<"empty">("empty"));

type BlockType = "empty" | ValueType | U32;
const BlockType = or([Empty, S33, ValueType], (t) =>
  t === "empty" ? Empty : typeof t === "number" ? S33 : ValueType
);

const Block = record({ blockType: BlockType, instructions: Expression });
const IfBlock = record({ blockType: BlockType, instructions: IfExpression });
