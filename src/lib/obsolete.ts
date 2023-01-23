type Instruction = ControlInstruction;

type Index = u32;
type BlockType = "empty" | ValueType | Index;

function blockType(type: BlockType) {
  if (type === "empty") return [0x40];
  if (typeof type === "number") return s33(type);
  return valueType(type);
}

type GenericInstruction<T extends string> = { kind: T };

type ControlInstruction =
  | { kind: "unreachable" }
  | { kind: "nop" }
  | { kind: "block"; blockType: BlockType; instr: Instruction[] }
  | { kind: "loop"; blockType: BlockType; instr: Instruction[] }
  | {
      kind: "if";
      blockType: BlockType;
      instr: Instruction[];
      elseInstr: Instruction[];
    }
  | { kind: "br"; labelIndex: Index }
  | { kind: "br_if"; labelIndex: Index }
  // | { kind: "br_table"; labelIndices: Index[], labelIndex: Index }
  | { kind: "return" }
  | { kind: "call"; functionIndex: Index }
  | { kind: "call_indirect"; typeIndex: Index; tableIndex: Index };

const end = 0x0b;
const controlKind = {
  unreachable: 0x00,
  nop: 0x01,
  block: 0x02,
  loop: 0x03,
  if: 0x04,
  else: 0x05,
  br: 0x0c,
  br_if: 0x0d,
  br_table: 0x0e,
  return: 0x0f,
  call: 0x10,
  call_indirect: 0x11,
};

function isControlInstruction(
  instruction: Instruction
): instruction is ControlInstruction {
  return Object.keys(controlKind).includes(instruction.kind);
}

function controlInstruction(control: ControlInstruction): number[] {
  let code = controlKind[control.kind];
  switch (control.kind) {
    case "unreachable":
    case "nop":
    case "return":
      return [code];
    case "block":
    case "loop":
      return [
        code,
        ...blockType(control.blockType),
        ...control.instr.map(instruction).flat(),
        end,
      ];
    case "if":
      let bytes = [code, ...instructions(control.instr)];
      if (control.elseInstr.length !== 0) {
        bytes.push(controlKind.else, ...instructions(control.elseInstr));
      }
      bytes.push(end);
      return bytes;
    case "br":
    case "br_if":
      return [code, ...u32(control.labelIndex)];
    case "call":
      return [code, ...u32(control.functionIndex)];
    case "call_indirect":
      return [code, ...u32(control.typeIndex), ...u32(control.tableIndex)];
    default:
      let _: never = control;
      throw Error("invalid control instruction");
  }
}

// TODO reference instructions
// TODO parametric instructions

type VariableInstruction =
  | {
      kind: "local";
      sub: "get" | "set" | "tee";
      index: Index;
    }
  | {
      kind: "global";
      sub: "get" | "set";
      index: Index;
    };

const variableKind = {
  local: {
    get: 0x20,
    set: 0x21,
    tee: 0x22,
  },
  global: {
    get: 0x23,
    set: 0x24,
  },
};

function isVariableInstruction(
  instruction: Instruction
): instruction is ControlInstruction {
  return Object.keys(controlKind).includes(instruction.kind);
}

function variableInstruction({ kind, sub, index }: VariableInstruction) {
  if (kind === "local") {
    return [variableKind[kind][sub], ...u32(index)];
  } else {
    return [variableKind[kind][sub], ...u32(index)];
  }
}

function instruction(instruction: Instruction): number[] {
  if (isControlInstruction(instruction)) {
    return controlInstruction(instruction);
  }
  if (isVariableInstruction(instruction)) {
    return variableInstruction(instruction);
  }
  throw "todo";
}
function instructions(instr: Instruction[]) {
  return instr.map(instruction).flat();
}
