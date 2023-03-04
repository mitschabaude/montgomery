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
import { InstructionName, nameToOpcode } from "./opcodes.js";

export {
  simpleInstruction,
  baseInstruction,
  BaseInstruction,
  resolveInstruction,
  resolveExpression,
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
type ResolvedInstruction = { string: string; immediate: any };

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
  let instruction = { string, opcode, immediate, resolve };
  nameToInstruction[string] = instruction;
  opcodeToInstruction[opcode] = instruction;
  return i;
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

function resolveInstruction(
  { string, deps, resolveArgs }: Dependency.Instruction,
  depToIndex: Map<Dependency.t, number>
): ResolvedInstruction {
  let instr = lookupInstruction(string);
  let depIndices: number[] = [];
  for (let dep of deps) {
    let index = depToIndex.get(dep);
    if (index === undefined) {
      if (dep.kind === "hasRefTo") index = 0;
      else if (dep.kind === "hasMemory") index = 0;
      else throw Error("bug: no index for dependency");
    }
    depIndices.push(index);
  }
  let immediate = instr.resolve(depIndices, ...resolveArgs);
  return { string, immediate };
}

const noResolve = (_: number[], ...args: any) => args[0];
type Tuple<T> = [T, ...T[]] | [];

// TODO: the input type is simply taken as the current stack, which could be much larger than the minimal needed input type
// to compute the minimal type signature, local context needs to keep track of the minimum stack height
function createExpression(
  name: LocalContext["frames"][number]["opcode"],
  ctx: LocalContext,
  run: () => void
): {
  body: Dependency.Instruction[];
  type: FunctionType;
  deps: Dependency.t[];
} {
  let args = [...ctx.stack];
  let stack = [...ctx.stack];
  let { stack: results, body } = withContext(
    ctx,
    {
      body: [],
      stack,
      frames: [
        {
          opcode: name,
          startTypes: null,
          endTypes: null,
          unreachable: false,
          stack,
        },
        ...ctx.frames,
      ],
    },
    run
  );
  return { body, type: { args, results }, deps: body.flatMap((i) => i.deps) };
}
function resolveExpression(deps: number[], body: Dependency.Instruction[]) {
  let instructions: ResolvedInstruction[] = [];
  let offset = 0;
  for (let instr of body) {
    let n = instr.deps.length;
    let myDeps = deps.slice(offset, offset + n);
    let instrObject = lookupInstruction(instr.string);
    let immediate = instrObject.resolve(myDeps, ...instr.resolveArgs);
    instructions.push({ string: instr.string, immediate });
    offset += n;
  }
  return instructions;
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
