import { I32, I64, U32 } from "../immediate.js";
import { baseInstruction, instruction, instructionWithArg } from "./base.js";
import {
  i32t,
  i64t,
  f32t,
  f64t,
  ValueTypeObject,
  valueTypeLiterals,
} from "../types.js";
import { record } from "../binable.js";
import { LocalContext } from "../local-context.js";
import { InstructionName } from "./opcodes.js";

export { i32Ops, i64Ops, f32Ops, f64Ops };

type MemArg = { offset: U32; align: U32 };
const MemArg = record({ offset: U32, align: U32 });

const i32Ops = {
  // memory
  load: memoryInstruction("i32.load", 32, [i32t], [i32t]),
  load16_s: memoryInstruction("i32.load16_s", 16, [i32t], [i32t]),
  load16_u: memoryInstruction("i32.load16_u", 16, [i32t], [i32t]),
  load8_s: memoryInstruction("i32.load8_s", 8, [i32t], [i32t]),
  load8_u: memoryInstruction("i32.load8_u", 8, [i32t], [i32t]),
  store: memoryInstruction("i32.store", 32, [i32t, i32t], []),
  store16: memoryInstruction("i32.store16", 16, [i32t, i32t], []),
  store8: memoryInstruction("i32.store8", 8, [i32t, i32t], []),

  // numeric
  const: instructionWithArg("i32.const", I32, [], [i32t]),
  add: instruction("i32.add", [i32t, i32t], [i32t]),
  eq: instruction("i32.eq", [i32t, i32t], [i32t]),
  ne: instruction("i32.ne", [i32t, i32t], [i32t]),
};

const i64Ops = {
  // memory
  load: memoryInstruction("i64.load", 64, [i32t], [i64t]),
  load32_s: memoryInstruction("i64.load32_s", 32, [i32t], [i64t]),
  load32_u: memoryInstruction("i64.load32_u", 32, [i32t], [i64t]),
  load16_s: memoryInstruction("i64.load16_s", 16, [i32t], [i64t]),
  load16_u: memoryInstruction("i64.load16_u", 16, [i32t], [i64t]),
  load8_s: memoryInstruction("i64.load8_s", 8, [i32t], [i64t]),
  load8_u: memoryInstruction("i64.load8_u", 8, [i32t], [i64t]),
  store: memoryInstruction("i64.store", 64, [i32t, i64t], []),
  store32: memoryInstruction("i64.store32", 32, [i32t, i64t], []),
  store16: memoryInstruction("i64.store16", 16, [i32t, i64t], []),
  store8: memoryInstruction("i64.store8", 8, [i32t, i64t], []),

  // numeric
  const: instructionWithArg("i64.const", I64, [], [i64t]),
};

const f32Ops = {
  // memory
  load: memoryInstruction("f32.load", 32, [i32t], [f32t]),
  store: memoryInstruction("f32.store", 32, [i32t, f32t], []),
};

const f64Ops = {
  // memory
  load: memoryInstruction("f64.load", 64, [i32t], [f64t]),
  store: memoryInstruction("f64.store", 64, [i32t, f64t], []),
};

function memoryInstruction(
  name: InstructionName,
  bits: number,
  args: ValueTypeObject[],
  results: ValueTypeObject[]
) {
  return baseInstruction<
    MemArg,
    [memArg: { offset?: number; align?: number }],
    [memArg: MemArg]
  >(name, MemArg, {
    create(
      _: LocalContext,
      { offset = 0, align = bits / 8 }: { offset?: number; align?: number }
    ) {
      return {
        in: valueTypeLiterals(args),
        out: valueTypeLiterals(results),
        resolveArgs: [{ offset, align }],
      };
    },
  });
}
