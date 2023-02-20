import { record } from "./binable.js";
import { U32 } from "./immediate.js";
import { baseInstruction } from "./instruction-base.js";

export { local };

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
};
