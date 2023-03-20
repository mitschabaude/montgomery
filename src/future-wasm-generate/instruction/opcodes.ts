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
  0x46: "i32.eq",
  0x47: "i32.ne",
  0x48: "i32.lt_s",
  0x49: "i32.lt_u",
  0x4a: "i32.gt_s",
  0x4b: "i32.gt_u",
  0x4c: "i32.le_s",
  0x4d: "i32.le_u",
  0x4e: "i32.ge_s",
  0x4f: "i32.ge_u",

  0x50: "i64.eqz",
  0x51: "i64.eq",
  0x52: "i64.ne",
  0x53: "i64.lt_s",
  0x54: "i64.lt_u",
  0x55: "i64.gt_s",
  0x56: "i64.gt_u",
  0x57: "i64.le_s",
  0x58: "i64.le_u",
  0x59: "i64.ge_s",
  0x5a: "i64.ge_u",

  0x5b: "f32.eq",
  0x5c: "f32.ne",
  0x5d: "f32.lt",
  0x5e: "f32.gt",
  0x5f: "f32.le",
  0x60: "f32.ge",

  0x61: "f64.eq",
  0x62: "f64.ne",
  0x63: "f64.lt",
  0x64: "f64.gt",
  0x65: "f64.le",
  0x66: "f64.ge",

  0x67: "i32.clz",
  0x68: "i32.ctz",
  0x69: "i32.popcnt",
  0x6a: "i32.add",
  0x6b: "i32.sub",
  0x6c: "i32.mul",
  0x6d: "i32.div_s",
  0x6e: "i32.div_u",
  0x6f: "i32.rem_s",
  0x70: "i32.rem_u",
  0x71: "i32.and",
  0x72: "i32.or",
  0x73: "i32.xor",
  0x74: "i32.shl",
  0x75: "i32.shr_s",
  0x76: "i32.shr_u",
  0x77: "i32.rotl",
  0x78: "i32.rotr",

  0x79: "i64.clz",
  0x7a: "i64.ctz",
  0x7b: "i64.popcnt",
  0x7c: "i64.add",
  0x7d: "i64.sub",
  0x7e: "i64.mul",
  0x7f: "i64.div_s",
  0x80: "i64.div_u",
  0x81: "i64.rem_s",
  0x82: "i64.rem_u",
  0x83: "i64.and",
  0x84: "i64.or",
  0x85: "i64.xor",
  0x86: "i64.shl",
  0x87: "i64.shr_s",
  0x88: "i64.shr_u",
  0x89: "i64.rotl",
  0x8a: "i64.rotr",

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
