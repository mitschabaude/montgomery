import {
  Binable,
  Byte,
  iso,
  orDefault,
  orUndefined,
  record,
  tuple,
  withByteCode,
  withPreamble,
  withValidation,
} from "./binable.js";
import { Code, Func } from "./function.js";
import { U32, vec, withByteLength } from "./immediate.js";
import { FunctionType, MemoryType, TableType } from "./types.js";
import { Export, ParsedImport, Import } from "./export.js";
import { Data, Global } from "./memory.js";

export { Module };

type Module = {
  imports: Import[];
  functions: Func[];
  tables: TableType[];
  memory?: MemoryType;
  globals: Global[];
  exports: Export[];
  start?: Func;
  data: Data[];
};

type ParsedModule = {
  version: number;
  typeSection: TypeSection;
  importSection: ImportSection;
  funcSection: FuncSection;
  tableSection: TableSection;
  memorySection: MemorySection;
  globalSection: GlobalSection;
  exportSection: ExportSection;
  startSection?: StartSection;
  codeSection: CodeSection;
  dataSection: DataSection;
  dataCountSection?: DataCountSection;
};

function section<T>(code: number, b: Binable<T>) {
  return withByteCode(code, withByteLength(b));
}
// 0: CustomSection

// 1: TypeSection
type TypeSection = FunctionType[];
let TypeSection = section<TypeSection>(1, vec(FunctionType));

// 2: ImportSection
type ImportSection = ParsedImport[];
let ImportSection = section<ImportSection>(2, vec(ParsedImport));

// 3: FuncSection
type FuncSection = U32[];
let FuncSection = section<FuncSection>(3, vec(U32));

// 4: TableSection
type TableSection = TableType[];
let TableSection = section<TableSection>(4, vec(TableType));

// 5: MemorySection
type MemorySection = MemoryType[];
let MemorySection = section<MemorySection>(5, vec(MemoryType));

// 6: GlobalSection
type GlobalSection = Global[];
let GlobalSection = section<GlobalSection>(6, vec(Global));

// 7: ExportSection
type ExportSection = Export[];
let ExportSection = section<ExportSection>(7, vec(Export));

// 8: StartSection
type StartSection = U32;
let StartSection = section<StartSection>(8, U32);

// 9: ElementSection

// 10: CodeSection
type CodeSection = Code[];
let CodeSection = section<CodeSection>(10, vec(Code));

// 11: DataSection
type DataSection = Data[];
let DataSection = section<DataSection>(11, vec(Data));

// 12: DataCountSection
type DataCountSection = U32;
let DataCountSection = section<DataCountSection>(12, U32);

const Version = iso(tuple([Byte, Byte, Byte, Byte]), {
  to(n: number) {
    return [n, 0x00, 0x00, 0x00];
  },
  from([n0, n1, n2, n3]) {
    if (n1 || n2 || n3) throw Error("invalid version");
    return n0;
  },
});

const isEmpty = (arr: unknown[]) => arr.length === 0;

let ParsedModule = withPreamble(
  [0x00, 0x61, 0x73, 0x6d],
  record<ParsedModule>(
    {
      version: Version,
      typeSection: orDefault(TypeSection, [], isEmpty),
      importSection: orDefault(ImportSection, [], isEmpty),
      funcSection: orDefault(FuncSection, [], isEmpty),
      tableSection: orDefault(TableSection, [], isEmpty),
      memorySection: orDefault(MemorySection, [], isEmpty),
      globalSection: orDefault(GlobalSection, [], isEmpty),
      exportSection: orDefault(ExportSection, [], isEmpty),
      startSection: orUndefined(StartSection),
      dataCountSection: orUndefined(DataCountSection),
      codeSection: orDefault(CodeSection, [], isEmpty),
      dataSection: orDefault(DataSection, [], isEmpty),
    },
    [
      "version",
      "typeSection",
      "importSection",
      "funcSection",
      "tableSection",
      "memorySection",
      "globalSection",
      "exportSection",
      "startSection",
      "dataCountSection",
      "codeSection",
      "dataSection",
    ]
  )
);

ParsedModule = withValidation(
  ParsedModule,
  ({ version, funcSection, codeSection, startSection, memorySection }) => {
    if (version !== 1) throw Error("unsupported version");
    if (funcSection.length !== codeSection.length) {
      throw Error("length of function and code sections do not match.");
    }
    if (memorySection.length > 1) {
      throw Error("multiple memories are not allowed");
    }
    if (startSection !== undefined && !funcSection.includes(startSection)) {
      throw Error("start function index must be included in function section");
    }
  }
);

const Module = iso<ParsedModule, Module>(ParsedModule, {
  to({ imports, functions, tables, memory, globals, exports, start, data }) {
    let importSection: ImportSection = [];
    let importedFunctionTypes: FunctionType[] = [];
    for (let { module, string, description } of imports) {
      if (description.kind !== "function") {
        importSection.push({ module, name: string, description });
        continue;
      }
      let functionType = description.value;
      let typeIdx = importedFunctionTypes.length;
      importedFunctionTypes[typeIdx] = functionType;
      let description_ = { kind: <"function">"function", value: typeIdx };
      importSection.push({ module, name: string, description: description_ });
    }
    let importedFunctionLength = importedFunctionTypes.length;
    let typeSection = importedFunctionTypes.concat(
      functions.map((f) => f.type)
    );
    let funcSection = typeSection
      .map((_, i) => i)
      .slice(importedFunctionLength);
    let memorySection = memory ? [memory] : [];
    let startSection = start && functions.indexOf(start);
    if (startSection === -1) {
      throw Error("start function is not included in functions");
    }
    let codeSection = functions.map(({ locals, body }) => ({ locals, body }));
    let exportSection: Export[] = exports;
    return {
      version: 1,
      typeSection,
      importSection,
      funcSection,
      tableSection: tables,
      memorySection,
      globalSection: globals,
      exportSection,
      startSection,
      codeSection,
      dataSection: data,
      dataCountSection: data.length,
    };
  },
  from({
    typeSection,
    importSection,
    funcSection,
    tableSection,
    memorySection,
    globalSection,
    exportSection,
    startSection,
    codeSection,
    dataSection,
    dataCountSection,
  }) {
    let importedFunctionsLength = 0;
    let imports = importSection.map(
      ({ module, name, description }: ParsedImport): Import => {
        if (description.kind !== "function")
          return { module, string: name, description };
        importedFunctionsLength++;
        let { kind, value: typeIdx } = description;
        let description_ = { kind, value: typeSection[typeIdx] };
        return { module, string: name, description: description_ };
      }
    );
    let functions = funcSection.map((typeIdx, funcIdx) => {
      let type = typeSection[typeIdx];
      let { locals, body } = codeSection[funcIdx];
      return { index: importedFunctionsLength + funcIdx, type, locals, body };
    });
    let start =
      startSection === undefined ? undefined : functions[startSection];
    let [memory] = memorySection;
    let exports: Export[] = exportSection;
    if (dataSection.length !== (dataCountSection ?? 0))
      throw Error("data section length does not match data count section");
    return {
      imports,
      functions,
      tables: tableSection,
      memory,
      globals: globalSection,
      exports,
      start,
      data: dataSection,
    };
  },
});
