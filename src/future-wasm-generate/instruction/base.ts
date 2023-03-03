import { Binable, Undefined } from "../binable.js";
import * as Dependency from "../dependency.js";
import {
  LocalContext,
  pushInstruction,
  withContext,
} from "../local-context.js";
import {
  FunctionType,
  ValueType,
  valueTypeLiterals,
  ValueTypeObject,
} from "../types.js";
import { InstructionName, nameToOpcode, opcodes } from "./opcodes.js";

export {
  simpleInstruction,
  baseInstruction,
  BaseInstruction,
  createExpression,
  lookupInstruction,
  lookupOpcode,
};

const nameToInstruction: Record<string, BaseInstruction> = {};
const opcodeToInstruction: Record<number, BaseInstruction> = {};

type BaseInstruction = {
  string: string;
  opcode: number;
  immediate: Binable<any> | undefined;
  resolve: (deps: number[], ...args: any) => any;
};

/**
 * most general function to create instructions
 */
function baseInstruction<
  Immediate,
  Args extends any[],
  ResolveArgs extends Tuple<any>
>(
  string: InstructionName,
  immediate: Binable<Immediate> | undefined = undefined,
  {
    create,
    resolve,
  }: {
    create(
      ctx: LocalContext,
      ...args: Args
    ): {
      in?: ValueType[];
      out?: ValueType[];
      deps?: Dependency.t[];
      resolveArgs?: ResolveArgs;
    };
    resolve?(deps: number[], ...args: ResolveArgs): Immediate;
  }
) {
  resolve ??= noResolve;
  function i(ctx: LocalContext, ...createArgs: Args) {
    let {
      in: args = [],
      out: results = [],
      deps = [],
      resolveArgs = createArgs,
    } = create(ctx, ...createArgs);
    pushInstruction(ctx, {
      string,
      deps,
      type: { args, results },
      resolveArgs,
    });
  }
  let opcode = nameToOpcode[string];
  let instruction = Object.assign(i, { string, opcode, immediate, resolve });
  nameToInstruction[string] = instruction;
  opcodeToInstruction[opcode] = instruction;
  return instruction;
}

/**
 * instructions of constant type without dependencies
 */
function simpleInstruction<
  Arguments extends Tuple<ValueTypeObject>,
  Results extends Tuple<ValueTypeObject>,
  Immediate extends any
>(
  string: InstructionName,
  immediate: Binable<Immediate> | undefined,
  { in: args, out: results }: { in?: Arguments; out?: Results }
) {
  immediate = immediate === Undefined ? undefined : immediate;
  type Args = Immediate extends undefined ? [] : [immediate: Immediate];
  let instr = {
    in: valueTypeLiterals(args ?? []),
    out: valueTypeLiterals(results ?? []),
  };
  return baseInstruction<Immediate, Args, Args>(string, immediate, {
    create: () => instr,
  });
}

const noResolve = (_: number[], ...args: any) => args[0];
type Tuple<T> = [T, ...T[]] | [];

function createExpression(
  ctx: LocalContext,
  run: () => void
): { body: Dependency.Instruction[]; type: FunctionType } {
  let args = [...ctx.stack];
  let { stack: results, body } = withContext(
    ctx,
    { body: [], stack: [...ctx.stack], labels: [null, ...ctx.labels] },
    run
  );
  return { body, type: { args, results } };
}

function lookupInstruction(name: string) {
  let instr = nameToInstruction[name];
  if (instr === undefined) throw Error(`invalid instruction name "${name}"`);
  return instr;
}
function lookupOpcode(opcode: number) {
  let instr = opcodeToInstruction[opcode];
  if (instr === undefined) throw Error(`invalid opcode "${opcode}"`);
  return instr;
}
