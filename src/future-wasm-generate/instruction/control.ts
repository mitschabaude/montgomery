import { Undefined } from "../binable.js";
import { Dependency } from "../func.js";
import { U32 } from "../immediate.js";
import { baseInstruction } from "./base.js";

export { control };
export { unreachable, call };

let unreachable = baseInstruction("unreachable", Undefined, {
  create({ stack }) {
    return { in: [...stack], out: [] };
  },
  resolve: () => undefined,
});
let call = baseInstruction("call", U32, {
  create(_, func: Dependency.AnyFunc) {
    return { in: func.type.args, out: func.type.results, deps: [func] };
  },
  resolve: ([funcIndex]) => funcIndex,
});
let control = { unreachable, call };
