export { opcodes, nameToOpcode, InstructionName };

type Opcodes = typeof opcodes;
type InstructionName = Opcodes[keyof Opcodes];

const opcodes = {
  // control
  0x00: "unreachable",
  0x01: "nop",
  0x02: "block",
  0x03: "loop",
  0x04: "if",
  // 0x05: "else", // not an instruction
  // 0x0b: "end", // not an instruction
  0x0c: "br",
  0x0d: "br_if",
  0x0e: "br_table",
  0x0f: "return",
  0x10: "call",
  0x11: "call_indirect",

  // parametric
  0x1a: "drop",
  0x1b: "select",
  0x1c: "select_t",

  // variable
  0x20: "local.get",
  0x21: "local.set",
  0x22: "local.tee",
  0x23: "global.get",
  0x24: "global.set",
  0x25: "table.get",
  0x26: "table.set",

  // memory
  0x28: "i32.load",
  0x29: "i64.load",
  0x2a: "f32.load",
  0x2b: "f64.load",
  0x2c: "i32.load8_s",
  0x2d: "i32.load8_u",
  0x2e: "i32.load16_s",
  0x2f: "i32.load16_u",
  0x30: "i64.load8_s",
  0x31: "i64.load8_u",
  0x32: "i64.load16_s",
  0x33: "i64.load16_u",
  0x34: "i64.load32_s",
  0x35: "i64.load32_u",
  0x36: "i32.store",
  0x37: "i64.store",
  0x38: "f32.store",
  0x39: "f64.store",
  0x3a: "i32.store8",
  0x3b: "i32.store16",
  0x3c: "i64.store8",
  0x3d: "i64.store16",
  0x3e: "i64.store32",
  0x3f: "memory.size",
  0x40: "memory.grow",

  // numeric
  0x41: "i32.const",
  0x42: "i64.const",
  0x43: "f32.const",
  0x44: "f64.const",
  0x45: "i32.eqz",

  0x6a: "i32.add",

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
