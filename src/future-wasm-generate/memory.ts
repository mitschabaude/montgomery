import { Const } from "./dependency.js";
import * as Dependency from "./dependency.js";
import { Limits, RefTypeObject, valueTypeLiteral } from "./types.js";

export { table, elem };

function table({
  type,
  min,
  max,
}: {
  type: RefTypeObject;
  min: number;
  max?: number;
}): Dependency.Table {
  return {
    kind: "table",
    type: { type: valueTypeLiteral(type), limits: { min, max } },
    deps: [],
  };
}

function elem(
  {
    type,
    mode,
  }: {
    type: RefTypeObject;
    mode:
      | "passive"
      | "declarative"
      | {
          table: Dependency.AnyTable;
          offset: Const.i32 | Const.globalGet;
        };
  },
  init: (Const.refFunc | Const.refNull)[]
): Dependency.Elem {
  let deps = init.flatMap((i) => i.deps as Dependency.Elem["deps"]);
  let result = {
    kind: "elem" as const,
    type: valueTypeLiteral(type),
    init,
    mode,
    deps,
  };
  if (typeof mode === "object") {
    mode.table.deps.push(result);
    deps.push(mode.table);
    deps.push(...(mode.offset.deps as Dependency.Elem["deps"]));
  }
  return result;
}
