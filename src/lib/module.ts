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
import {
  FunctionIndex,
  FunctionType,
  GlobalType,
  MemoryType,
  TableType,
  ValueType,
} from "./types.js";
import { Export, Import } from "./export.js";
import { Data, Elem, Global } from "./memory.js";

export { Module, ValidationContext };

type Module = {
  types: FunctionType[];
  funcs: Func[];
  tables: TableType[];
  memory?: MemoryType;
  globals: Global[];
  elems: Elem[];
  datas: Data[];
  start?: Func;
  imports: Import[];
  exports: Export[];
};

function section<T>(code: number, b: Binable<T>) {
  return withByteCode(code, withByteLength(b));
}
// 0: CustomSection

// 1: TypeSection
type TypeSection = FunctionType[];
let TypeSection = section<TypeSection>(1, vec(FunctionType));

// 2: ImportSection
type ImportSection = Import[];
let ImportSection = section<ImportSection>(2, vec(Import));

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
type ElemSection = Elem[];
let ElemSection = section<ElemSection>(11, vec(Elem));

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
  elemSection: ElemSection;
  dataCountSection?: DataCountSection;
  codeSection: CodeSection;
  dataSection: DataSection;
};

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
      elemSection: orDefault(ElemSection, [], isEmpty),
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
      "elemSection",
      "dataCountSection",
      "codeSection",
      "dataSection",
    ]
  )
);

ParsedModule = withValidation(
  ParsedModule,
  ({
    version,
    funcSection,
    codeSection,
    startSection,
    memorySection,
    dataSection,
    dataCountSection,
  }) => {
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
    if (dataSection.length !== (dataCountSection ?? 0))
      throw Error("data section length does not match data count section");
  }
);

const Module = iso<ParsedModule, Module>(ParsedModule, {
  to({
    types,
    imports,
    funcs,
    tables,
    memory,
    globals,
    exports,
    start,
    datas,
    elems,
  }) {
    let funcSection = funcs.map((f) => f.typeIndex);
    let memorySection = memory ? [memory] : [];
    let startSection = start && funcs.indexOf(start);
    if (startSection === -1) {
      throw Error("start function is not included in functions");
    }
    let codeSection = funcs.map(({ locals, body }) => ({ locals, body }));
    let exportSection: Export[] = exports;
    return {
      version: 1,
      typeSection: types,
      importSection: imports,
      funcSection,
      tableSection: tables,
      memorySection,
      globalSection: globals,
      exportSection,
      startSection,
      codeSection,
      dataSection: datas,
      dataCountSection: datas.length,
      elemSection: elems,
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
    elemSection,
  }): Module {
    let importedFunctionsLength = importSection.filter(
      (i) => i.description.kind === "function"
    ).length;
    let funcs = funcSection.map((typeIndex, funcIdx) => {
      let type = typeSection[typeIndex];
      let { locals, body } = codeSection[funcIdx];
      return {
        functionIndex: importedFunctionsLength + funcIdx,
        typeIndex,
        type,
        locals,
        body,
      };
    });
    let start = startSection === undefined ? undefined : funcs[startSection];
    let [memory] = memorySection;
    let exports: Export[] = exportSection;
    return {
      types: typeSection,
      imports: importSection,
      funcs,
      tables: tableSection,
      memory,
      globals: globalSection,
      exports,
      start,
      datas: dataSection,
      elems: elemSection,
    };
  },
});

type ValidationContext = {
  types: FunctionType[];
  funcs: FunctionType[];
  tables: TableType[];
  memories: MemoryType[];
  globals: GlobalType[];
  elems: Elem[];
  datas: Data[];
  locals: ValueType[];
  labels: ValueType[][];
  return?: ValueType[];
  refs: FunctionIndex[];
};
