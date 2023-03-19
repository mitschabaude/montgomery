import { I32, I64 } from "../immediate.js";
import { instruction, instructionWithArg } from "./base.js";
import { i32t, i64t, f32t, f64t } from "../types.js";

export { i32Ops, i64Ops };

const i32Ops = {
  const: instructionWithArg("i32.const", I32, [], [i32t]),
  add: instruction("i32.add", [i32t, i32t], [i32t]),
  eq: instruction("i32.eq", [i32t, i32t], [i32t]),
  ne: instruction("i32.ne", [i32t, i32t], [i32t]),
};

const i64Ops = {
  const: instructionWithArg("i64.const", I64, [], [i64t]),
};
