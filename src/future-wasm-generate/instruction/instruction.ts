import { local, global, ref } from "./variable.js";
import { i32, i64 } from "./int.js";
import { control } from "./control.js";
import { Instruction } from "./binable.js";
import { resolveInstruction } from "./base.js";
export { Expression, ConstExpression } from "./binable.js";

export { ops, i32, i64, local, global, control };
export { Instruction, resolveInstruction };

const ops = { i32, local, ref, global, ...control };
