export { opcodes, nameToOpcode, InstructionName };

type Opcodes = typeof opcodes;
type InstructionName = Opcodes[keyof Opcodes];

const opcodes = {
  // control
  0x00: "unreachable",
  0x01: "nop",
  0x02: "block",
  0x10: "call",

  // numeric
  0x41: "i32.const",

  0x6a: "i32.add",

  // variable
  0x20: "local.get",
  0x21: "local.set",
  0x22: "local.tee",
  0x23: "global.get",
  0x24: "global.set",

  // reference
  0xd0: "ref.null",
  0xd1: "ref.is_null",
  0xd2: "ref.func",
} as const satisfies Record<number, string>;

// inverted map
const nameToOpcode: Record<string, number> = {};
for (let code in opcodes) {
  nameToOpcode[opcodes[Number(code) as keyof Opcodes]] = Number(code);
}
