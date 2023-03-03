import { Undefined } from "../binable.js";
import { Const } from "../dependency.js";
import * as Dependency from "../dependency.js";
import { U32 } from "../immediate.js";
import { baseInstruction } from "./base.js";
import { RefType } from "../types.js";

export { local, global, ref };

type Local = { index: number };

const local = {
  get: baseInstruction("local.get", U32, {
    create({ locals }, x: Local) {
      let local = locals[x.index];
      if (local === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { out: [local] };
    },
    resolve: (_, x: Local) => x.index,
  }),
  set: baseInstruction("local.set", U32, {
    create({ locals }, x: Local) {
      let local = locals[x.index];
      if (local === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { in: [local] };
    },
    resolve: (_, x: Local) => x.index,
  }),
  tee: baseInstruction("local.tee", U32, {
    create({ locals }, x: Local) {
      let type = locals[x.index];
      if (type === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { in: [type], out: [type] };
    },
    resolve: (_, x: Local) => x.index,
  }),
};

const globalInstr = {
  get: baseInstruction("global.get", U32, {
    create(_, global: Dependency.AnyGlobal) {
      return { out: [global.type.value], deps: [global] };
    },
    resolve: ([globalIdx]) => globalIdx,
  }),
  set: baseInstruction("global.set", U32, {
    create(_, global: Dependency.AnyGlobal) {
      if (!global.type.mutable) {
        throw Error("global.set used on immutable global");
      }
      return { in: [global.type.value], deps: [global] };
    },
    resolve: ([globalIdx]) => globalIdx,
  }),
};

function globalConstructor(
  init: Const.t,
  { mutable = false } = {}
): Dependency.Global {
  let deps = init.deps as Dependency.Global["deps"];
  let type = init.type.results[0];
  return { kind: "global", type: { value: type, mutable }, init, deps };
}

const global = Object.assign(globalConstructor, globalInstr);

const ref = {
  null: baseInstruction("ref.null", RefType, {
    create(_, type: RefType) {
      return { out: [type] };
    },
  }),
  is_null: baseInstruction("ref.is_null", Undefined, {
    create({ stack }) {
      return { in: [stack[stack.length - 1]], out: ["i32"] };
    },
  }),
  func: baseInstruction("ref.func", U32, {
    create(_, func: Dependency.AnyFunc) {
      return { out: ["funcref"], deps: [func, Dependency.hasRefTo(func)] };
    },
    resolve: ([funcIdx]) => funcIdx,
  }),
};
