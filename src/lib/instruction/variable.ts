import { record } from "../binable.js";
import { Const } from "../dependency.js";
import * as Dependency from "../dependency.js";
import { U32 } from "../immediate.js";
import { baseInstruction } from "./base.js";

export { local, global };

type ConcreteLocal = { index: number };
const ConcreteLocal = record({ index: U32 });

const local = {
  get: baseInstruction("local.get", ConcreteLocal, {
    create({ locals }, x: ConcreteLocal) {
      let local = locals[x.index];
      if (local === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { out: [local] };
    },
    resolve: (_, x: ConcreteLocal) => x,
  }),
  set: baseInstruction("local.set", ConcreteLocal, {
    create({ locals }, x: ConcreteLocal) {
      let local = locals[x.index];
      if (local === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { in: [local] };
    },
    resolve: (_, x: ConcreteLocal) => x,
  }),
  tee: baseInstruction("local.tee", ConcreteLocal, {
    create({ locals }, x: ConcreteLocal) {
      let type = locals[x.index];
      if (type === undefined)
        throw Error(`local with index ${x.index} not available`);
      return { in: [type], out: [type] };
    },
    resolve: (_, x: ConcreteLocal) => x,
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
