import { F32, F64, I32, I64, U8 } from "../immediate.js";
import { instruction, instructionWithArg } from "./base.js";
import { i32t, i64t, f32t, f64t, v128t } from "../types.js";
import { memoryLaneInstruction, memoryInstruction } from "./memory.js";
import { array, Byte, iso, tuple } from "../binable.js";
import { bigintFromBytes, bigintToBytes } from "../../util.js";

type V128 = bigint;
const V128 = iso<Byte[], V128>(array(Byte, 16), {
  to(s) {
    return [...bigintToBytes(s, 16)];
  },
  from(t) {
    return bigintFromBytes(Uint8Array.from(t));
  },
});

const v128Ops = {
  // memory
  load: memoryInstruction("v128.load", 128, [i32t], [v128t]),
  load8x8_s: memoryInstruction("v128.load8x8_s", 8, [i32t], [v128t]),
  load8x8_u: memoryInstruction("v128.load8x8_u", 8, [i32t], [v128t]),
  load16x4_s: memoryInstruction("v128.load16x4_s", 16, [i32t], [v128t]),
  load16x4_u: memoryInstruction("v128.load16x4_u", 16, [i32t], [v128t]),
  load32x2_s: memoryInstruction("v128.load32x2_s", 32, [i32t], [v128t]),
  load32x2_u: memoryInstruction("v128.load32x2_u", 32, [i32t], [v128t]),
  load8_splat: memoryInstruction("v128.load8_splat", 8, [i32t], [v128t]),
  load16_splat: memoryInstruction("v128.load16_splat", 16, [i32t], [v128t]),
  load32_splat: memoryInstruction("v128.load32_splat", 32, [i32t], [v128t]),
  load64_splat: memoryInstruction("v128.load64_splat", 64, [i32t], [v128t]),
  load32_zero: memoryInstruction("v128.load32_zero", 32, [i32t], [v128t]),
  load64_zero: memoryInstruction("v128.load64_zero", 64, [i32t], [v128t]),
  store: memoryInstruction("v128.store", 128, [i32t, v128t], []),

  load8_lane: memoryLaneInstruction(
    "v128.load8_lane",
    8,
    [i32t, v128t],
    [v128t]
  ),
  load16_lane: memoryLaneInstruction(
    "v128.load16_lane",
    16,
    [i32t, v128t],
    [v128t]
  ),
  load32_lane: memoryLaneInstruction(
    "v128.load32_lane",
    32,
    [i32t, v128t],
    [v128t]
  ),
  load64_lane: memoryLaneInstruction(
    "v128.load64_lane",
    64,
    [i32t, v128t],
    [v128t]
  ),
  store8_lane: memoryLaneInstruction("v128.store8_lane", 8, [i32t, v128t], []),
  store16_lane: memoryLaneInstruction(
    "v128.store16_lane",
    16,
    [i32t, v128t],
    []
  ),
  store32_lane: memoryLaneInstruction(
    "v128.store32_lane",
    32,
    [i32t, v128t],
    []
  ),
  store64_lane: memoryLaneInstruction(
    "v128.store64_lane",
    64,
    [i32t, v128t],
    []
  ),

  // const
  const: instructionWithArg("v128.const", V128, [v128t], [v128t]),

  // logical
  not: instruction("v128.not", [v128t], [v128t]),
  and: instruction("v128.and", [v128t, v128t], [v128t]),
  andnot: instruction("v128.andnot", [v128t, v128t], [v128t]),
  or: instruction("v128.or", [v128t, v128t], [v128t]),
  xor: instruction("v128.xor", [v128t, v128t], [v128t]),
  bitselect: instruction("v128.bitselect", [v128t, v128t, v128t], [v128t]),
  any_true: instruction("v128.any_true", [v128t], [i32t]),
};

const i8x16Ops = {
  // shuffle
  shuffle: instructionWithArg(
    "i8x16.shuffle",
    array(U8, 16),
    [v128t, v128t],
    [v128t]
  ),

  // lane
  extract_lane_s: instructionWithArg(
    "i8x16.extract_lane_s",
    U8,
    [v128t],
    [i32t]
  ),
  extract_lane_u: instructionWithArg(
    "i8x16.extract_lane_u",
    U8,
    [v128t],
    [i32t]
  ),
  replace_lane: instructionWithArg(
    "i8x16.replace_lane",
    U8,
    [v128t, i32t],
    [v128t]
  ),

  // swizzle / splat
  swizzle: instruction("i8x16.swizzle", [v128t, v128t], [v128t]),
  splat: instruction("i8x16.splat", [i32t], [v128t]),

  // comparison
  eq: instruction("i8x16.eq", [v128t, v128t], [v128t]),
  ne: instruction("i8x16.ne", [v128t, v128t], [v128t]),
  lt_s: instruction("i8x16.lt_s", [v128t, v128t], [v128t]),
  lt_u: instruction("i8x16.lt_u", [v128t, v128t], [v128t]),
  gt_s: instruction("i8x16.gt_s", [v128t, v128t], [v128t]),
  gt_u: instruction("i8x16.gt_u", [v128t, v128t], [v128t]),
  le_s: instruction("i8x16.le_s", [v128t, v128t], [v128t]),
  le_u: instruction("i8x16.le_u", [v128t, v128t], [v128t]),
  ge_s: instruction("i8x16.ge_s", [v128t, v128t], [v128t]),
  ge_u: instruction("i8x16.ge_u", [v128t, v128t], [v128t]),

  // logic & arithmetic
  abs: instruction("i8x16.abs", [v128t], [v128t]),
  neg: instruction("i8x16.neg", [v128t], [v128t]),
  popcnt: instruction("i8x16.popcnt", [v128t], [v128t]),
  all_true: instruction("i8x16.all_true", [v128t], [i32t]),
  bitmask: instruction("i8x16.bitmask", [v128t], [i32t]),
  narrow_i16x8_s: instruction("i8x16.narrow_i16x8_s", [v128t, v128t], [v128t]),
  narrow_i16x8_u: instruction("i8x16.narrow_i16x8_u", [v128t, v128t], [v128t]),
  shl: instruction("i8x16.shl", [v128t, i32t], [v128t]),
  shr_s: instruction("i8x16.shr_s", [v128t, i32t], [v128t]),
  shr_u: instruction("i8x16.shr_u", [v128t, i32t], [v128t]),
  add: instruction("i8x16.add", [v128t, v128t], [v128t]),
  add_sat_s: instruction("i8x16.add_sat_s", [v128t, v128t], [v128t]),
  add_sat_u: instruction("i8x16.add_sat_u", [v128t, v128t], [v128t]),
  sub: instruction("i8x16.sub", [v128t, v128t], [v128t]),
  sub_sat_s: instruction("i8x16.sub_sat_s", [v128t, v128t], [v128t]),
  sub_sat_u: instruction("i8x16.sub_sat_u", [v128t, v128t], [v128t]),
  min_s: instruction("i8x16.min_s", [v128t, v128t], [v128t]),
  min_u: instruction("i8x16.min_u", [v128t, v128t], [v128t]),
  max_s: instruction("i8x16.max_s", [v128t, v128t], [v128t]),
  max_u: instruction("i8x16.max_u", [v128t, v128t], [v128t]),
  avgr_u: instruction("i8x16.avgr_u", [v128t, v128t], [v128t]),
};

const i16x8Ops = {
  // lane
  extract_lane_s: instructionWithArg(
    "i16x8.extract_lane_s",
    U8,
    [v128t],
    [i32t]
  ),
  extract_lane_u: instructionWithArg(
    "i16x8.extract_lane_u",
    U8,
    [v128t],
    [i32t]
  ),
  replace_lane: instructionWithArg(
    "i16x8.replace_lane",
    U8,
    [v128t, i32t],
    [v128t]
  ),

  // splat
  splat: instruction("i16x8.splat", [i32t], [v128t]),

  // comparison
  eq: instruction("i16x8.eq", [v128t, v128t], [v128t]),
  ne: instruction("i16x8.ne", [v128t, v128t], [v128t]),
  lt_s: instruction("i16x8.lt_s", [v128t, v128t], [v128t]),
  lt_u: instruction("i16x8.lt_u", [v128t, v128t], [v128t]),
  gt_s: instruction("i16x8.gt_s", [v128t, v128t], [v128t]),
  gt_u: instruction("i16x8.gt_u", [v128t, v128t], [v128t]),
  le_s: instruction("i16x8.le_s", [v128t, v128t], [v128t]),
  le_u: instruction("i16x8.le_u", [v128t, v128t], [v128t]),
  ge_s: instruction("i16x8.ge_s", [v128t, v128t], [v128t]),
  ge_u: instruction("i16x8.ge_u", [v128t, v128t], [v128t]),

  // logic & arithmetic
  extadd_pairwise_i8x16_s: instruction(
    "i16x8.extadd_pairwise_i8x16_s",
    [v128t],
    [v128t]
  ),
  extadd_pairwise_i8x16_u: instruction(
    "i16x8.extadd_pairwise_i8x16_u",
    [v128t],
    [v128t]
  ),
  abs: instruction("i16x8.abs", [v128t], [v128t]),
  neg: instruction("i16x8.neg", [v128t], [v128t]),
  q15mulr_sat_s: instruction("i16x8.q15mulr_sat_s", [v128t, v128t], [v128t]),
  all_true: instruction("i16x8.all_true", [v128t], [i32t]),
  bitmask: instruction("i16x8.bitmask", [v128t], [i32t]),
  narrow_i32x4_s: instruction("i16x8.narrow_i32x4_s", [v128t, v128t], [v128t]),
  narrow_i32x4_u: instruction("i16x8.narrow_i32x4_u", [v128t, v128t], [v128t]),
  extend_low_i8x16_s: instruction("i16x8.extend_low_i8x16_s", [v128t], [v128t]),
  extend_high_i8x16_s: instruction(
    "i16x8.extend_high_i8x16_s",
    [v128t],
    [v128t]
  ),
  extend_low_i8x16_u: instruction("i16x8.extend_low_i8x16_u", [v128t], [v128t]),
  extend_high_i8x16_u: instruction(
    "i16x8.extend_high_i8x16_u",
    [v128t],
    [v128t]
  ),
  shl: instruction("i16x8.shl", [v128t, i32t], [v128t]),
  shr_s: instruction("i16x8.shr_s", [v128t, i32t], [v128t]),
  shr_u: instruction("i16x8.shr_u", [v128t, i32t], [v128t]),
  add: instruction("i16x8.add", [v128t, v128t], [v128t]),
  add_sat_s: instruction("i16x8.add_sat_s", [v128t, v128t], [v128t]),
  add_sat_u: instruction("i16x8.add_sat_u", [v128t, v128t], [v128t]),
  sub: instruction("i16x8.sub", [v128t, v128t], [v128t]),
  sub_sat_s: instruction("i16x8.sub_sat_s", [v128t, v128t], [v128t]),
  sub_sat_u: instruction("i16x8.sub_sat_u", [v128t, v128t], [v128t]),
  mul: instruction("i16x8.mul", [v128t, v128t], [v128t]),
  min_s: instruction("i16x8.min_s", [v128t, v128t], [v128t]),
  min_u: instruction("i16x8.min_u", [v128t, v128t], [v128t]),
  max_s: instruction("i16x8.max_s", [v128t, v128t], [v128t]),
  max_u: instruction("i16x8.max_u", [v128t, v128t], [v128t]),
  avgr_u: instruction("i16x8.avgr_u", [v128t, v128t], [v128t]),
  extmul_low_i8x16_s: instruction(
    "i16x8.extmul_low_i8x16_s",
    [v128t, v128t],
    [v128t]
  ),
  extmul_high_i8x16_s: instruction(
    "i16x8.extmul_high_i8x16_s",
    [v128t, v128t],
    [v128t]
  ),
  extmul_low_i8x16_u: instruction(
    "i16x8.extmul_low_i8x16_u",
    [v128t, v128t],
    [v128t]
  ),
  extmul_high_i8x16_u: instruction(
    "i16x8.extmul_high_i8x16_u",
    [v128t, v128t],
    [v128t]
  ),
};

const i32x4Ops = {
  // lane
  extract_lane: instructionWithArg("i32x4.extract_lane", U8, [v128t], [i32t]),
  replace_lane: instructionWithArg(
    "i32x4.replace_lane",
    U8,
    [v128t, i32t],
    [v128t]
  ),

  // splat
  splat: instruction("i32x4.splat", [i32t], [v128t]),

  // comparison
  eq: instruction("i32x4.eq", [v128t, v128t], [v128t]),
  ne: instruction("i32x4.ne", [v128t, v128t], [v128t]),
  lt_s: instruction("i32x4.lt_s", [v128t, v128t], [v128t]),
  lt_u: instruction("i32x4.lt_u", [v128t, v128t], [v128t]),
  gt_s: instruction("i32x4.gt_s", [v128t, v128t], [v128t]),
  gt_u: instruction("i32x4.gt_u", [v128t, v128t], [v128t]),
  le_s: instruction("i32x4.le_s", [v128t, v128t], [v128t]),
  le_u: instruction("i32x4.le_u", [v128t, v128t], [v128t]),
  ge_s: instruction("i32x4.ge_s", [v128t, v128t], [v128t]),
  ge_u: instruction("i32x4.ge_u", [v128t, v128t], [v128t]),

  // logic & arithmetic
  // TODO
};

const i64x2Ops = {
  // lane
  extract_lane: instructionWithArg("i64x2.extract_lane", U8, [v128t], [i64t]),
  replace_lane: instructionWithArg(
    "i64x2.replace_lane",
    U8,
    [v128t, i64t],
    [v128t]
  ),

  // splat
  splat: instruction("i64x2.splat", [i64t], [v128t]),

  // comparison
  eq: instruction("i64x2.eq", [v128t, v128t], [v128t]),
  ne: instruction("i64x2.ne", [v128t, v128t], [v128t]),
  lt_s: instruction("i64x2.lt_s", [v128t, v128t], [v128t]),
  gt_s: instruction("i64x2.gt_s", [v128t, v128t], [v128t]),
  le_s: instruction("i64x2.le_s", [v128t, v128t], [v128t]),
  ge_s: instruction("i64x2.ge_s", [v128t, v128t], [v128t]),
};

const f32x4Ops = {
  // lane
  extract_lane: instructionWithArg("f32x4.extract_lane", U8, [v128t], [f32t]),
  replace_lane: instructionWithArg(
    "f32x4.replace_lane",
    U8,
    [v128t, f32t],
    [v128t]
  ),

  // splat
  splat: instruction("f32x4.splat", [f32t], [v128t]),

  // comparison
  eq: instruction("f32x4.eq", [v128t, v128t], [v128t]),
  ne: instruction("f32x4.ne", [v128t, v128t], [v128t]),
  lt: instruction("f32x4.lt", [v128t, v128t], [v128t]),
  gt: instruction("f32x4.gt", [v128t, v128t], [v128t]),
  le: instruction("f32x4.le", [v128t, v128t], [v128t]),
  ge: instruction("f32x4.ge", [v128t, v128t], [v128t]),
};

const f64x2Ops = {
  // lane
  extract_lane: instructionWithArg("f64x2.extract_lane", U8, [v128t], [f64t]),
  replace_lane: instructionWithArg(
    "f64x2.replace_lane",
    U8,
    [v128t, f64t],
    [v128t]
  ),

  // splat
  splat: instruction("f64x2.splat", [f64t], [v128t]),

  // comparison
  eq: instruction("f64x2.eq", [v128t, v128t], [v128t]),
  ne: instruction("f64x2.ne", [v128t, v128t], [v128t]),
  lt: instruction("f64x2.lt", [v128t, v128t], [v128t]),
  gt: instruction("f64x2.gt", [v128t, v128t], [v128t]),
  le: instruction("f64x2.le", [v128t, v128t], [v128t]),
  ge: instruction("f64x2.ge", [v128t, v128t], [v128t]),
};