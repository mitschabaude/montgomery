import { baseInstruction } from "./base.js";
import * as Dependency from "../dependency.js";
import { LocalContext } from "../local-context.js";
import { U32 } from "../immediate.js";

export { memoryOps };

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
