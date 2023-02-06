import { Binable, byteEnum, record } from "./binable.js";
import { addCall, Func, FunctionContext } from "./function.js";
import { Name, U32 } from "./immediate.js";
import {
  FunctionType,
  GlobalType,
  MemoryType,
  TableType,
  TypeIndex,
  valueType,
  ValueType,
} from "./types.js";

export { Export, Import, ExternType, exportFunction, importFunction };

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

function exportFunction({
  string,
  typeIndex: index,
}: Func & { string: string }): Export {
  return { name: string, description: { kind: "function", value: index } };
}

type ImportDescription =
  | { kind: "function"; value: TypeIndex }
  | { kind: "table"; value: TableType }
  | { kind: "memory"; value: MemoryType }
  | { kind: "global"; value: GlobalType };
const ImportDescription: Binable<ImportDescription> = byteEnum<{
  0x00: { kind: "function"; value: TypeIndex };
  0x01: { kind: "table"; value: TableType };
  0x02: { kind: "memory"; value: MemoryType };
  0x03: { kind: "global"; value: GlobalType };
}>({
  0x00: { kind: "function", value: TypeIndex },
  0x01: { kind: "table", value: TableType },
  0x02: { kind: "memory", value: MemoryType },
  0x03: { kind: "global", value: GlobalType },
});

type Import = {
  module: string;
  string: string;
  description: ImportDescription;
};
const Import = record<Import>(
  { module: Name, string: Name, description: ImportDescription },
  ["module", "string", "description"]
);

function importFunction(
  ctx: FunctionContext,
  name: string,
  args_: ValueType[],
  results_: ValueType[]
) {
  let args: ValueType[] = args_.map((a) => valueType(a.kind));
  let results: ValueType[] = results_.map((r) => valueType(r.kind));
  let type = { args, results };
  let typeIndex = ctx.types.length;
  ctx.types.push(type);
  ctx.importedFunctionsLength++;
  let importObj: Import = {
    module: "env",
    string: name,
    description: { kind: <"function">"function", value: typeIndex },
  };
  return Object.assign(
    function () {
      addCall(ctx, name, type, typeIndex);
    },
    { import: importObj }
  );
}
