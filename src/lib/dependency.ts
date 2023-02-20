/**
 * interfaces for declaring functions stand-alone (without reference to a module)
 * that keep track of their dependencies. Declaring them as the exports of a module
 * should enable to automatically include all dependencies in that module and determine
 * indices for them.
 */

import {
  externref,
  funcref,
  FunctionType,
  GlobalType,
  i32t,
  i64t,
  MemoryType,
  RefType,
  TableType,
  ValueType,
} from "./types.js";
import { Byte } from "./binable.js";
import { I32, I64 } from "./immediate.js";

export {
  t,
  Export,
  anyDependency,
  Type,
  Func,
  HasRefTo,
  Global,
  Table,
  Memory,
  HasMemory,
  Data,
  Elem,
  ImportFunc,
  ImportGlobal,
  ImportTable,
  ImportMemory,
  AnyFunc,
  AnyGlobal,
  AnyMemory,
  AnyTable,
  AnyImport,
  Instruction,
  Const,
};

type anyDependency = { kind: string; deps: anyDependency[] };

type Export = AnyFunc | AnyGlobal | AnyMemory | AnyTable;

type t =
  | Type
  | Func
  | HasRefTo
  | Global
  | Table
  | Memory
  | HasMemory
  | Data
  | Elem
  | ImportFunc
  | ImportGlobal
  | ImportTable
  | ImportMemory;

type Type = { kind: "type"; type: FunctionType; deps: [] };

type Func = {
  kind: "function";
  type: FunctionType;
  locals: ValueType[];
  body: Instruction[];
  deps: t[];
};
type HasRefTo = { kind: "hasRefTo"; value: Func; deps: [] };

type Global = {
  kind: "global";
  type: GlobalType;
  init: Const.t;
  deps: (AnyGlobal | AnyFunc)[];
};

type Table = {
  kind: "table";
  type: TableType;
  deps: [];
};
type Memory = {
  kind: "memory";
  type: MemoryType;
  deps: [];
};
type HasMemory = { kind: "hasMemory"; deps: [] };

type Data = {
  kind: "data";
  init: Byte[];
  mode: "passive" | { memory: 0; offset: Const.i32 | Const.globalGet };
  deps: (HasMemory | AnyGlobal)[];
};

type Elem = {
  kind: "elem";
  type: RefType;
  init: (Const.refFunc | Const.refNull)[];
  mode:
    | "passive"
    | "declarative"
    | {
        table: TableType;
        offset: Const.i32 | Const.globalGet;
      };
  deps: (AnyTable | AnyFunc | AnyGlobal)[];
};

type ImportPath = { module: string; string: string; deps: [] };
type ImportFunc = ImportPath & {
  kind: "importFunction";
  type: FunctionType;
  value: Function;
};
type ImportGlobal = ImportPath & {
  kind: "importGlobal";
  type: GlobalType;
  value: WebAssembly.Global | number;
};
type ImportTable = ImportPath & {
  kind: "importTable";
  type: TableType;
  value: WebAssembly.Table;
};
type ImportMemory = ImportPath & {
  kind: "importMemory";
  type: MemoryType;
  value: WebAssembly.Memory;
};

type AnyFunc = Func | ImportFunc;
type AnyGlobal = Global | ImportGlobal;
type AnyTable = Table | ImportTable;
type AnyMemory = Memory | ImportMemory;
type AnyImport = ImportFunc | ImportGlobal | ImportTable | ImportMemory;

// general instruction

type Instruction = {
  string: string;
  type: FunctionType;
  immediate?: any;
  deps: t[];
  resolveArgs: any[];
};

// constant instructions

namespace Const {
  export type i32 = Instruction & { string: "i32.const"; immediate: I32 };
  export type i64 = Instruction & { string: "i64.const"; immediate: I64 };
  export type refNull = Instruction & { string: "ref.null" };
  export type refFunc = Instruction & { string: "ref.func" };
  export type globalGet = Instruction & { string: "global.get" };
  export type t = i32 | i64 | refNull | refFunc | globalGet;
}

const Const = {
  i32(x: number | bigint): Const.i32 {
    return {
      string: "i32.const",
      immediate: Number(x),
      type: { args: [], results: [i32t] },
      deps: [],
      resolveArgs: [],
    };
  },
  i64(x: number | bigint): Const.i64 {
    return {
      string: "i64.const",
      immediate: BigInt(x),
      type: { args: [], results: [i64t] },
      deps: [],
      resolveArgs: [],
    };
  },
  refFuncNull: {
    string: "ref.null",
    type: { args: [], results: [funcref] },
    deps: [],
    resolveArgs: [],
  } as Const.refNull,
  refExternNull: {
    string: "ref.null",
    type: { args: [], results: [externref] },
    deps: [],
    resolveArgs: [],
  } as Const.refNull,
  refFunc(func: AnyFunc): Const.refFunc {
    return {
      string: "ref.func",
      type: { args: [], results: [funcref] },
      deps: [func],
      resolveArgs: [],
    };
  },
  globalGet(global: Global): Const.globalGet {
    if (global.type.mutable)
      throw Error("global in a const expression can not be mutable");
    return {
      string: "global.get",
      type: { args: [], results: [global.type.value] },
      deps: [global],
      resolveArgs: [],
    };
  },
};
