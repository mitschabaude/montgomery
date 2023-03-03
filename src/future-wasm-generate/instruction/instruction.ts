import * as Dependency from "../dependency.js";
import { local, global, ref } from "./variable.js";
import { i32, i64 } from "./int.js";
import { control } from "./control.js";
import { Instruction } from "./binable.js";
import { lookupInstruction } from "./base.js";
export { Expression, ConstExpression } from "./binable.js";

export { ops, i32, i64, local, global };
export { Instruction, resolveInstruction };

const ops = { i32, local, ref, global, ...control };

function resolveInstruction(
  { string, deps, resolveArgs }: Dependency.Instruction,
  depToIndex: Map<Dependency.t, number>
): Instruction {
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
