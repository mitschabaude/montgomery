import { I32, I64, U32 } from "../immediate.js";
import { baseInstruction, instruction, instructionWithArg } from "./base.js";
import {
  i32t,
  i64t,
  f32t,
  f64t,
  valueTypeLiterals,
  ValueType,
  ValueTypeObjects,
} from "../types.js";
import { record } from "../binable.js";
import { LocalContext } from "../local-context.js";
import { InstructionName } from "./opcodes.js";
import * as Dependency from "../dependency.js";
import { Tuple } from "../util.js";

export { i32Ops, i64Ops, f32Ops, f64Ops };

type MemArg = { align: U32; offset: U32 };
const MemArg = record({ align: U32, offset: U32 });

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

  // const
  const: instructionWithArg("i32.const", I32, [], [i32t]),

  // comparison
  eqz: instruction("i32.eqz", [i32t], [i32t]),
  eq: instruction("i32.eq", [i32t, i32t], [i32t]),
  ne: instruction("i32.ne", [i32t, i32t], [i32t]),
  lt_s: instruction("i32.lt_s", [i32t, i32t], [i32t]),
  lt_u: instruction("i32.lt_u", [i32t, i32t], [i32t]),
  gt_s: instruction("i32.gt_u", [i32t, i32t], [i32t]),
  gt_u: instruction("i32.gt_u", [i32t, i32t], [i32t]),
  le_s: instruction("i32.le_s", [i32t, i32t], [i32t]),
  le_u: instruction("i32.le_u", [i32t, i32t], [i32t]),
  ge_s: instruction("i32.ge_s", [i32t, i32t], [i32t]),
  ge_u: instruction("i32.ge_u", [i32t, i32t], [i32t]),

  // unary
  clz: instruction("i32.clz", [i32t], [i32t]),
  ctz: instruction("i32.ctz", [i32t], [i32t]),
  popcnt: instruction("i32.popcnt", [i32t], [i32t]),

  // binary
  add: instruction("i32.add", [i32t, i32t], [i32t]),
  sub: instruction("i32.sub", [i32t, i32t], [i32t]),
  mul: instruction("i32.mul", [i32t, i32t], [i32t]),
  div_s: instruction("i32.div_s", [i32t, i32t], [i32t]),
  div_u: instruction("i32.div_u", [i32t, i32t], [i32t]),
  rem_s: instruction("i32.rem_s", [i32t, i32t], [i32t]),
  rem_u: instruction("i32.rem_u", [i32t, i32t], [i32t]),
  and: instruction("i32.and", [i32t, i32t], [i32t]),
  or: instruction("i32.or", [i32t, i32t], [i32t]),
  xor: instruction("i32.xor", [i32t, i32t], [i32t]),
  shl: instruction("i32.shl", [i32t, i32t], [i32t]),
  shr_s: instruction("i32.shr_s", [i32t, i32t], [i32t]),
  shr_u: instruction("i32.shr_u", [i32t, i32t], [i32t]),
  rotl: instruction("i32.rotl", [i32t, i32t], [i32t]),
  rotr: instruction("i32.rotr", [i32t, i32t], [i32t]),
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

  // const
  const: instructionWithArg("i64.const", I64, [], [i64t]),

  // comparison
  eqz: instruction("i64.eqz", [i64t], [i32t]),
  eq: instruction("i64.eq", [i64t, i64t], [i32t]),
  ne: instruction("i64.ne", [i64t, i64t], [i32t]),
  lt_s: instruction("i64.lt_s", [i64t, i64t], [i32t]),
  lt_u: instruction("i64.lt_u", [i64t, i64t], [i32t]),
  gt_s: instruction("i64.gt_u", [i64t, i64t], [i32t]),
  gt_u: instruction("i64.gt_u", [i64t, i64t], [i32t]),
  le_s: instruction("i64.le_s", [i64t, i64t], [i32t]),
  le_u: instruction("i64.le_u", [i64t, i64t], [i32t]),
  ge_s: instruction("i64.ge_s", [i64t, i64t], [i32t]),
  ge_u: instruction("i64.ge_u", [i64t, i64t], [i32t]),

  // unary
  clz: instruction("i64.clz", [i64t], [i64t]),
  ctz: instruction("i64.ctz", [i64t], [i64t]),
  popcnt: instruction("i64.popcnt", [i64t], [i64t]),

  // binary
  add: instruction("i64.add", [i64t, i64t], [i64t]),
  sub: instruction("i64.sub", [i64t, i64t], [i64t]),
  mul: instruction("i64.mul", [i64t, i64t], [i64t]),
  div_s: instruction("i64.div_s", [i64t, i64t], [i64t]),
  div_u: instruction("i64.div_u", [i64t, i64t], [i64t]),
  rem_s: instruction("i64.rem_s", [i64t, i64t], [i64t]),
  rem_u: instruction("i64.rem_u", [i64t, i64t], [i64t]),
  and: instruction("i64.and", [i64t, i64t], [i64t]),
  or: instruction("i64.or", [i64t, i64t], [i64t]),
  xor: instruction("i64.xor", [i64t, i64t], [i64t]),
  shl: instruction("i64.shl", [i64t, i64t], [i64t]),
  shr_s: instruction("i64.shr_s", [i64t, i64t], [i64t]),
  shr_u: instruction("i64.shr_u", [i64t, i64t], [i64t]),
  rotl: instruction("i64.rotl", [i64t, i64t], [i64t]),
  rotr: instruction("i64.rotr", [i64t, i64t], [i64t]),
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

function memoryInstruction<
  Args extends Tuple<ValueType>,
  Results extends Tuple<ValueType>
>(
  name: InstructionName,
  bits: number,
  args: ValueTypeObjects<Args>,
  results: ValueTypeObjects<Results>
) {
  return baseInstruction<
    MemArg,
    [memArg: { offset?: number; align?: number }],
    [memArg: MemArg],
    Args,
    Results
  >(name, MemArg, {
    create(
      _: LocalContext,
      { offset = 0, align = bits / 8 }: { offset?: number; align?: number }
    ) {
      let alignExponent = Math.log2(align);
      if (!Number.isInteger(alignExponent)) {
        throw Error(`${name}: \`align\` must be power of 2, got ${align}`);
      }
      return {
        in: valueTypeLiterals(args),
        out: valueTypeLiterals(results),
        resolveArgs: [{ offset, align: alignExponent }],
        deps: [Dependency.hasMemory],
      };
    },
  });
}
