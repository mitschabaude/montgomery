import { Binable, Undefined } from "../binable.js";
import * as Dependency from "../dependency.js";
import { LocalContext, pushInstruction } from "../local-context.js";
import { ValueType } from "../types.js";

export { simpleInstruction, baseInstruction, BaseInstruction };

type BaseInstruction = {
  string: string;
  immediate: Binable<any> | undefined;
  resolve: (deps: number[], ...args: any) => any;
};

/**
 * most general function to create instructions
 */
function baseInstruction<Immediate, Args extends any[]>(
  string: string,
  immediate: Binable<Immediate> | undefined = undefined,
  {
    create,
    resolve,
  }: {
    create(
      ctx: LocalContext,
      ...args: Args
    ): { in?: ValueType[]; out?: ValueType[]; deps?: Dependency.t[] };
    resolve(deps: number[], ...args: Args): Immediate;
  }
) {
  function i(ctx: LocalContext, ...resolveArgs: Args) {
    let {
      in: args = [],
      out: results = [],
      deps = [],
    } = create(ctx, ...resolveArgs);
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
  Arguments extends Tuple<ValueType>,
  Results extends Tuple<ValueType>,
  Immediate extends any
>(
  string: string,
  immediate: Binable<Immediate> | undefined,
  { in: args, out: results }: { in?: Arguments; out?: Results }
) {
  immediate = immediate === Undefined ? undefined : immediate;
  type Args = Immediate extends undefined ? [] : [immediate: Immediate];
  let instr = { in: args ?? [], out: results ?? [] };
  return baseInstruction<Immediate, Args>(string, immediate, {
    create: () => instr,
    resolve: (_, immediate) => immediate as Immediate,
  });
}

type Tuple<T> = [T, ...T[]] | [];
