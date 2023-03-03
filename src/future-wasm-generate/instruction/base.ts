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

export {
  simpleInstruction,
  baseInstruction,
  BaseInstruction,
  createExpression,
};

type BaseInstruction = {
  string: string;
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
  string: string,
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
  return Object.assign(i, { string, immediate, resolve });
}

/**
 * instructions of constant type without dependencies
 */
function simpleInstruction<
  Arguments extends Tuple<ValueTypeObject>,
  Results extends Tuple<ValueTypeObject>,
  Immediate extends any
>(
  string: string,
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
