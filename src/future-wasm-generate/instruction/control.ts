import { Undefined } from "../binable.js";
import * as Dependency from "../dependency.js";
import { U32 } from "../immediate.js";
import { popStack, pushStack, setUnreachable } from "../local-context.js";
import { functionTypeEquals, printFunctionType, ResultType } from "../types.js";
import {
  baseInstruction,
  createExpression,
  resolveExpression,
  simpleInstruction,
} from "./base.js";
import { Block, IfBlock } from "./binable.js";

export { control };
export { unreachable, call, nop, block, loop };

const nop = simpleInstruction("nop", Undefined, {});

// TODO
const unreachable = baseInstruction("unreachable", Undefined, {
  create(ctx) {
    setUnreachable(ctx);
    return {};
  },
  resolve: () => undefined,
});

const block = baseInstruction("block", Block, {
  create(ctx, run: () => void) {
    let { type, body, deps } = createExpression("block", ctx, run);
    return {
      in: type.args,
      out: type.results,
      deps: [Dependency.type(type), ...deps],
      resolveArgs: [body],
    };
  },
  resolve([blockType, ...deps], body: Dependency.Instruction[]) {
    let instructions = resolveExpression(deps, body);
    return { blockType, instructions };
  },
});

const loop = baseInstruction("loop", Block, {
  create(ctx, run: () => void) {
    let { type, body, deps } = createExpression("loop", ctx, run);
    return {
      in: type.args,
      out: type.results,
      deps: [Dependency.type(type), ...deps],
      resolveArgs: [body],
    };
  },
  resolve([blockType, ...deps], body: Dependency.Instruction[]) {
    let instructions = resolveExpression(deps, body);
    return { blockType, instructions };
  },
});

const if_ = baseInstruction("if", IfBlock, {
  create(ctx, runIf: () => void, runElse?: () => void) {
    popStack(ctx, ["i32"]);
    let { type, body, deps } = createExpression("if", ctx, runIf);
    let ifArgs: ResultType = [...type.args, "i32"];
    if (runElse === undefined) {
      pushStack(ctx, ["i32"]);
      return {
        in: ifArgs,
        out: type.results,
        deps: [Dependency.type(type), ...deps],
        resolveArgs: [body, undefined],
      };
    }
    let elseExpr = createExpression("else", ctx, runElse);
    pushStack(ctx, ["i32"]);
    if (!functionTypeEquals(type, elseExpr.type)) {
      throw Error(
        `Type signature of else branch doesn't match if branch.\n` +
          `If branch: ${printFunctionType(type)}\n` +
          `Else branch: ${printFunctionType(elseExpr.type)}`
      );
    }
    return {
      in: ifArgs,
      out: type.results,
      deps: [Dependency.type(type), ...deps, ...elseExpr.deps],
      resolveArgs: [body, elseExpr.body],
    };
  },
  resolve(
    [blockType, ...deps],
    ifBody: Dependency.Instruction[],
    elseBody?: Dependency.Instruction[]
  ) {
    let ifDepsLength = ifBody.reduce((acc, i) => acc + i.deps.length, 0);
    let if_ = resolveExpression(deps.slice(0, ifDepsLength), ifBody);
    let else_ =
      elseBody && resolveExpression(deps.slice(ifDepsLength), elseBody);
    return { blockType, instructions: { if: if_, else: else_ } };
  },
});

const call = baseInstruction("call", U32, {
  create(_, func: Dependency.AnyFunc) {
    return { in: func.type.args, out: func.type.results, deps: [func] };
  },
  resolve: ([funcIndex]) => funcIndex,
});

const control = { nop, unreachable, block, loop, if: if_, call };
