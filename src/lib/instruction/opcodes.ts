import { BaseInstruction } from "./base.js";
import { global, local } from "./variable.js";
import { i32 } from "./int.js";
import { call, unreachable } from "./control.js";

export { opcodes, instructionToOpcode };

const opcodes: Record<number, BaseInstruction> = {
  // control
  0x00: unreachable,
  0x10: call,

  // numeric
  0x41: i32.const,

  0x6a: i32.add,

  // variable
  0x20: local.get,
  0x21: local.set,
  0x22: local.tee,
  0x23: global.get,
  0x24: global.set,
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
