/**
 * interfaces for declaring functions stand-alone (without reference to a module)
 * that keep track of their dependencies. Declaring them as the exports of a module
 * should enable to automatically include all dependencies in that module and determine
 * indices for them.
 */

import { Instruction } from "./instruction.js";
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

type Dependency = { instructions: number[] } & (
  | { kind: "type"; value: FunctionType }
  | { kind: "function"; value: Func }
  | { kind: "global"; value: Global }
  | { kind: "table"; value: TableType }
  | { kind: "hasMemory" }
  | { kind: "memory"; value: MemoryType }
  | { kind: "data"; value: Data }
  | { kind: "elem"; value: Elem }
  | { kind: "hasRefTo"; value: Func }
  | { kind: "importFunction"; value: ImportFunction }
  | { kind: "importFable"; value: ImportTable }
  | { kind: "importMemory"; value: ImportMemory }
  | { kind: "importGlobal"; value: ImportGlobal }
);

type Func = {
  type: FunctionType;
  locals: ValueType[];
  body: Instruction[];
  deps: Dependency[];
};

type Global = {
  type: GlobalType;
  init: ConstInstruction;
  deps: (Dependency & {
    kind: "global" | "importGlobal" | "function" | "importFunction";
  })[];
};

type Data = {
  init: Byte[];
  mode: "passive" | { memory: 0; offset: I32Const | GlobalGet };
  deps: (Dependency & { kind: "hasMemory" | "global" })[];
};

type Elem = {
  type: RefType;
  init: (RefFunc | RefNull)[];
  mode:
    | "passive"
    | "declarative"
    | { table: TableType; offset: I32Const | GlobalGet };
  deps: (Dependency & {
    kind:
      | "table"
      | "importTable"
      | "function"
      | "importFunction"
      | "global"
      | "importGlobal";
  })[];
};

type ImportPath = { module: string; string: string; deps: never[] };
type ImportFunction = ImportPath & {
  type: FunctionType;
  function: Function;
};
type ImportTable = ImportPath & { type: TableType; value: WebAssembly.Table };
type ImportMemory = ImportPath & {
  type: MemoryType;
  value: WebAssembly.Memory;
};
type ImportGlobal = ImportPath & {
  type: GlobalType;
  value: WebAssembly.Global | number;
};

// constant instructions
type I32Const = { string: "i32.const"; immediate: I32 };
type I64Const = { string: "i64.const"; immediate: I64 };
type RefNull = { string: "ref.null" };
type RefFunc = { string: "ref.func"; immediate: 0 };
type GlobalGet = { string: "global.get"; immediate: 0 };
type ConstInstruction = I32Const | I64Const | RefNull | RefFunc | GlobalGet;
