import { Const } from "./dependency.js";
import * as Dependency from "./dependency.js";
import { Limits, RefTypeObject, valueTypeLiteral } from "./types.js";

export { table, elem };

function table(
  {
    type,
    min,
    max,
  }: {
    type: RefTypeObject;
    min: number;
    max?: number;
  },
  content?: (Const.refFunc | Const.refNull)[]
): Dependency.Table {
  let table = {
    kind: "table" as const,
    type: { type: valueTypeLiteral(type), limits: { min, max } },
    deps: [],
  };
  if (content !== undefined) {
    elem({ type, mode: { table, offset: Const.i32(0) } }, content);
  }
  return table;
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
