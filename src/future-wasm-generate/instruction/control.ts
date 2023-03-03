import { Undefined } from "../binable.js";
import { Dependency } from "../func.js";
import { U32 } from "../immediate.js";
import {
  baseInstruction,
  createExpression,
  lookupInstruction,
  simpleInstruction,
} from "./base.js";
import { BlockArgs, Instruction } from "./binable.js";

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
    let { type, body } = createExpression(ctx, run);
    return {
      in: type.args,
      out: type.results,
      deps: [{ kind: "type", type, deps: [] }, ...body.flatMap((i) => i.deps)],
      resolveArgs: [body],
    };
  },
  resolve([blockType, ...deps], body: Dependency.Instruction[]) {
    let instructions: Instruction[] = [];
    let offset = 0;
    for (let instr of body) {
      let n = instr.deps.length;
      let myDeps = deps.slice(offset, offset + n);
      let instrObject = lookupInstruction(instr.string);
      let immediate = instrObject.resolve(myDeps, ...instr.resolveArgs);
      instructions.push({ string: instr.string, immediate });
      offset += n;
    }
    return { blockType, instructions };
  },
});

const call = baseInstruction("call", U32, {
  create(_, func: Dependency.AnyFunc) {
    return { in: func.type.args, out: func.type.results, deps: [func] };
  },
  resolve: ([funcIndex]) => funcIndex,
});

let control = { nop, unreachable, call, block };
