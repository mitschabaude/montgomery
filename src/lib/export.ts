import { Binable, byteEnum, record } from "./binable.js";
import { Func } from "./function.js";
import { Name, U32 } from "./immediate.js";
import { Instruction } from "./instruction.js";
import {
  FunctionType,
  GlobalType,
  MemoryType,
  TableType,
  valueType,
  ValueType,
} from "./types.js";

export {
  Export,
  ParsedImport,
  Import,
  ExternType,
  exportFunction,
  importFunction,
  shiftFunctionIndices,
};

type ExternType =
  | { kind: "function"; value: FunctionType }
  | { kind: "table"; value: TableType }
  | { kind: "memory"; value: MemoryType }
  | { kind: "global"; value: GlobalType };

type ExportDescription = {
  kind: "function" | "table" | "memory" | "global";
  value: U32;
};
const ExportDescription: Binable<ExportDescription> = byteEnum<{
  0x00: { kind: "function"; value: U32 };
  0x01: { kind: "table"; value: U32 };
  0x02: { kind: "memory"; value: U32 };
  0x03: { kind: "global"; value: U32 };
}>({
  0x00: { kind: "function", value: U32 },
  0x01: { kind: "table", value: U32 },
  0x02: { kind: "memory", value: U32 },
  0x03: { kind: "global", value: U32 },
});

type Export = { name: string; description: ExportDescription };
const Export = record({ name: Name, description: ExportDescription }, [
  "name",
  "description",
]);

function exportFunction({ string, index }: Func & { string: string }): Export {
  return { name: string, description: { kind: "function", value: index } };
}

type ImportDescription =
  | { kind: "function"; value: U32 }
  | { kind: "table"; value: TableType }
  | { kind: "memory"; value: MemoryType }
  | { kind: "global"; value: GlobalType };
const ImportDescription: Binable<ImportDescription> = byteEnum<{
  0x00: { kind: "function"; value: U32 };
  0x01: { kind: "table"; value: TableType };
  0x02: { kind: "memory"; value: MemoryType };
  0x03: { kind: "global"; value: GlobalType };
}>({
  0x00: { kind: "function", value: U32 },
  0x01: { kind: "table", value: TableType },
  0x02: { kind: "memory", value: MemoryType },
  0x03: { kind: "global", value: GlobalType },
});

type ParsedImport = {
  module: string;
  name: string;
  description: ImportDescription;
};
const ParsedImport = record<ParsedImport>(
  { module: Name, name: Name, description: ImportDescription },
  ["module", "name", "description"]
);

type Import = {
  module: string;
  name: string;
  description: ExternType;
};

function importFunction(
  name: string,
  args_: ValueType[],
  results_: ValueType[]
): Import {
  let args = args_.map((a) => valueType(a.kind));
  let results = results_.map((r) => valueType(r.kind));
  return {
    module: "env",
    name,
    description: { kind: "function", value: { args, results } },
  };
}

// TODO: need cleaner solution for this
function shiftFunctionIndices(body: Instruction[], shift: number) {
  return body.map((instr): Instruction => {
    if (instr.string === "call")
      return { string: instr.string, immediate: instr.immediate + shift };
    return instr;
  });
}
