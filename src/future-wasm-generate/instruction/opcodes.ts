import { BaseInstruction } from "./base.js";
import { global, local, ref } from "./variable.js";
import { i32 } from "./int.js";
import { control } from "./control.js";

export { opcodes, instructionToOpcode };

const opcodes: Record<number, BaseInstruction> = {
  // control
  0x00: control.unreachable,
  0x01: control.nop,
  0x02: control.block,
  0x10: control.call,

  // numeric
  0x41: i32.const,

  0x6a: i32.add,

  // variable
  0x20: local.get,
  0x21: local.set,
  0x22: local.tee,
  0x23: global.get,
  0x24: global.set,

  // reference
  0xd0: ref.null,
  0xd1: ref.is_null,
  0xd2: ref.func,
};

const instructionToOpcode = invertOpcodes();

function invertOpcodes() {
  let map: Record<string, number> = {};
  type K = keyof typeof opcodes;
  for (let key in opcodes) {
    let code = Number(key);
    let instruction = opcodes[code as K];
    map[instruction.string] = code;
  }
  return map;
}
