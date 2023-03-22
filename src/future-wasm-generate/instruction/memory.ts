import { baseInstruction } from "./base.js";
import * as Dependency from "../dependency.js";
import { LocalContext } from "../local-context.js";
import { U32, U8 } from "../immediate.js";
import { record } from "../binable.js";
import { ValueType, valueTypeLiterals, ValueTypeObjects } from "../types.js";
import { Tuple } from "../util.js";
import { InstructionName } from "./opcodes.js";

export {
  memoryOps,
  memoryInstruction,
  memoryAndLaneInstruction as memoryLaneInstruction,
};

const memoryOps = {
  size: baseInstruction("memory.size", U32, {
    create(_: LocalContext) {
      return {
        in: [],
        out: ["i32"],
        deps: [Dependency.hasMemory],
        resolveArgs: [0],
      };
    },
  }),
  grow: baseInstruction("memory.grow", U32, {
    create(_: LocalContext) {
      return {
        in: ["i32"],
        out: ["i32"],
        deps: [Dependency.hasMemory],
        resolveArgs: [0],
      };
    },
  }),
  // TODO instructions with nested opcodes
  // init, copy, fill
};

type MemArg = { align: U32; offset: U32 };
const MemArg = record({ align: U32, offset: U32 });

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
    create(_: LocalContext, memArg: { offset?: number; align?: number }) {
      let memArg_ = memArgFromInput(name, bits, memArg);
      return {
        in: valueTypeLiterals(args),
        out: valueTypeLiterals(results),
        resolveArgs: [memArg_],
        deps: [Dependency.hasMemory],
      };
    },
  });
}

type MemArgAndLane = { memArg: MemArg; lane: U8 };
const MemArgAndLane = record({ memArg: MemArg, lane: U8 });

function memoryAndLaneInstruction<
  Args extends Tuple<ValueType>,
  Results extends Tuple<ValueType>
>(
  name: InstructionName,
  bits: number,
  args: ValueTypeObjects<Args>,
  results: ValueTypeObjects<Results>
) {
  return baseInstruction<
    MemArgAndLane,
    [memArg: { offset?: number; align?: number }, lane: number],
    [memArgAndLane: MemArgAndLane],
    Args,
    Results
  >(name, MemArgAndLane, {
    create(
      _: LocalContext,
      memArg: { offset?: number; align?: number },
      lane: number
    ) {
      let memArg_ = memArgFromInput(name, bits, memArg);
      return {
        in: valueTypeLiterals(args),
        out: valueTypeLiterals(results),
        resolveArgs: [{ memArg: memArg_, lane }],
        deps: [Dependency.hasMemory],
      };
    },
  });
}

function memArgFromInput(
  name: string,
  bits: number,
  { offset = 0, align = bits / 8 }: { offset?: number; align?: number }
) {
  let alignExponent = Math.log2(align);
  if (!Number.isInteger(alignExponent)) {
    throw Error(`${name}: \`align\` must be power of 2, got ${align}`);
  }
  return { offset, align: alignExponent };
}
