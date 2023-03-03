import { Undefined } from "../binable.js";
import * as Dependency from "../dependency.js";
import { U32 } from "../immediate.js";
import {
  baseInstruction,
  createExpression,
  resolveExpression,
  simpleInstruction,
} from "./base.js";
import { BlockArgs } from "./binable.js";

export { control };
export { unreachable, call, nop, block };

const nop = simpleInstruction("nop", Undefined, {});

// TODO
const unreachable = baseInstruction("unreachable", Undefined, {
  create({ stack }) {
    return { in: [...stack], out: [] };
  },
  resolve: () => undefined,
});

const block = baseInstruction("block", BlockArgs, {
  create(ctx, run: () => void) {
    let { type, body, deps } = createExpression(ctx, run);
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

const loop = baseInstruction("loop", BlockArgs, {
  create(ctx, run: () => void) {
    let { type, body, deps } = createExpression(ctx, run);
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

const call = baseInstruction("call", U32, {
  create(_, func: Dependency.AnyFunc) {
    return { in: func.type.args, out: func.type.results, deps: [func] };
  },
  resolve: ([funcIndex]) => funcIndex,
});

const control = { nop, unreachable, call, block };
