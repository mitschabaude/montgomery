/**
 * interfaces for declaring functions stand-alone (without reference to a module)
 * that keep track of their dependencies. Declaring them as the exports of a module
 * should enable to automatically include all dependencies in that module and determine
 * indices for them.
 */

import {
  FunctionType,
  GlobalType,
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
  Instruction,
  ConstInstruction,
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
  init: ConstInstruction;
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
  mode: "passive" | { memory: 0; offset: I32Const | GlobalGet };
  deps: (HasMemory | AnyGlobal)[];
};

type Elem = {
  kind: "elem";
  type: RefType;
  init: (RefFunc | RefNull)[];
  mode:
    | "passive"
    | "declarative"
    | { table: TableType; offset: I32Const | GlobalGet };
  deps: (AnyTable | AnyFunc | AnyGlobal)[];
};

type ImportPath = { module: string; string: string; deps: [] };
type ImportFunc = ImportPath & {
  kind: "importFunction";
  type: FunctionType;
  function: Function;
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

// constant instructions
type I32Const = { string: "i32.const"; immediate: I32 };
type I64Const = { string: "i64.const"; immediate: I64 };
type RefNull = { string: "ref.null" };
type RefFunc = { string: "ref.func"; immediate: 0 };
type GlobalGet = { string: "global.get"; immediate: 0 };
type ConstInstruction = I32Const | I64Const | RefNull | RefFunc | GlobalGet;

// general instruction
type Instruction = {
  string: string;
  type: FunctionType;
  immediate?: any;
  deps: t[];
  resolveArgs: any[];
};
