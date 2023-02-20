import { Binable } from "./binable.js";
import * as Dependency from "./dependency.js";
import { BaseInstruction } from "./instruction-base.js";
import { local } from "./instruction-local.js";
import { i32, i64 } from "./instruction-int.js";
import { call, control, unreachable } from "./instruction-control.js";

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
