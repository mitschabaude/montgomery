import { Const } from "./dependency.js";
import { Dependency } from "./func.js";

export { global };

function global(init: Const.t, { mutable = false } = {}): Dependency.Global {
  let deps = init.deps as Dependency.Global["deps"];
  let type = init.type.results[0];
  return { kind: "global", type: { value: type, mutable }, init, deps };
}
