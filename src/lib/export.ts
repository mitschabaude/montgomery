import { byteEnum, record } from "./binable.js";
import { Name, U32 } from "./immediate.js";
import { GlobalType, MemoryType, TableType } from "./types.js";

export { Export, Import };

const ExportDescription = byteEnum<{
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

const Export = record({ name: Name, description: ExportDescription }, [
  "name",
  "description",
]);

const ImportDescription = byteEnum<{
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

const Import = record(
  { module: Name, name: Name, description: ImportDescription },
  ["module", "name", "description"]
);
