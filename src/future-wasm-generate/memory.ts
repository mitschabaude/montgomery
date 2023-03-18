import { Const } from "./dependency.js";
import * as Dependency from "./dependency.js";
import { RefTypeObject, valueTypeLiteral } from "./types.js";

export { Memory, Data, Table, Elem };

function Memory(
  {
    min,
    max,
  }: {
    min: number;
    max?: number;
  },
  ...content: (number[] | Uint8Array)[]
): Dependency.Memory {
  let memory: Dependency.Memory = {
    kind: "memory",
    type: { limits: { min, max } },
    deps: [],
  };
  let offset = 0;
  for (let init of content) {
    Data({ memory, offset: Const.i32(offset) }, init);
    offset += init.length;
  }
  return memory;
}

function Data(
  mode:
    | {
        memory?: Dependency.AnyMemory;
        offset: Const.i32 | Const.globalGet;
      }
    | "passive",
  [...init]: number[] | Uint8Array
): Dependency.Data {
  if (mode === "passive") {
    return { kind: "data", init, mode, deps: [] };
  }
  let { memory, offset } = mode;
  let deps = [...offset.deps] as Dependency.AnyGlobal[];
  let result: Dependency.Data = {
    kind: "data",
    init,
    mode: { memory: 0, offset },
    deps,
  };
  if (memory !== undefined) {
    result.deps.push(memory);
    memory.deps.push(result);
  } else {
    result.deps.push(Dependency.hasMemory);
  }
  return result;
}

function Table(
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
    Elem({ type, mode: { table, offset: Const.i32(0) } }, content);
  }
  return table;
}

function Elem(
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
