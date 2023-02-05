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
import { FunctionType, MemoryType } from "./types.js";
import { Export, ParsedImport, Import } from "./export.js";

export { Module };

type Module = {
  imports: Import[];
  functions: Func[];
  memory?: MemoryType;
  exports: Export[];
  start?: Func;
};

type ParsedModule = {
  version: number;
  typeSection: TypeSection;
  funcSection: FuncSection;
  importSection: ImportSection;
  memorySection: MemorySection;
  exportSection: ExportSection;
  startSection?: StartSection;
  codeSection: CodeSection;
};

function section<T>(code: number, b: Binable<T>) {
  return withByteCode(code, withByteLength(b));
}
// 0: CustomSection

// 1: TypeSection
type TypeSection = FunctionType[];
let TypeSection: Binable<TypeSection> = section(1, vec(FunctionType));

// 2: ImportSection
type ImportSection = ParsedImport[];
let ImportSection: Binable<ImportSection> = section(2, vec(ParsedImport));

// 3: FuncSection
type FuncSection = U32[];
let FuncSection: Binable<FuncSection> = section(3, vec(U32));

// 4: TableSection

// 5: MemorySection
type MemorySection = MemoryType[];
let MemorySection: Binable<MemorySection> = section(5, vec(MemoryType));

// 6: GlobalSection

// 7: ExportSection
type ExportSection = Export[];
let ExportSection: Binable<ExportSection> = section(7, vec(Export));

// 8: StartSection
type StartSection = U32;
let StartSection: Binable<StartSection> = section(8, U32);

// 9: ElementSection

// 10: CodeSection
type CodeSection = Code[];
let CodeSection: Binable<CodeSection> = section(10, vec(Code));

// 11: DataSection

// 12: DataCountSection

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
      memorySection: orDefault(MemorySection, [], isEmpty),
      exportSection: orDefault(ExportSection, [], isEmpty),
      startSection: orUndefined(StartSection),
      codeSection: orDefault(CodeSection, [], isEmpty),
    },
    [
      "version",
      "typeSection",
      "importSection",
      "funcSection",
      "memorySection",
      "exportSection",
      "startSection",
      "codeSection",
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
  to({ imports, functions, memory, exports, start }) {
    let importSection: ImportSection = [];
    let importedFunctionTypes: FunctionType[] = [];
    for (let imp of imports) {
      if (imp.description.kind !== "function") {
        importSection.push({ ...imp, description: imp.description });
        continue;
      }
      let functionType = imp.description.value;
      let typeIdx = importedFunctionTypes.length;
      importedFunctionTypes[typeIdx] = functionType;
      let description = { kind: <"function">"function", value: typeIdx };
      importSection.push({ ...imp, description });
    }
    let typeSection = importedFunctionTypes.concat(
      functions.map((f) => f.type)
    );
    let funcSection = typeSection
      .map((_, i) => i)
      .slice(importedFunctionTypes.length);
    let memorySection = memory ? [memory] : [];
    let startSection = start && functions.indexOf(start);
    if (startSection === -1) {
      throw Error("start function is not included in functions");
    }
    let codeSection = functions.map(({ locals, body }) => ({ locals, body }));
    return {
      version: 1,
      typeSection,
      importSection,
      funcSection,
      memorySection,
      exportSection: exports,
      startSection,
      codeSection,
    };
  },
  from({
    typeSection,
    importSection,
    funcSection,
    memorySection,
    exportSection,
    startSection,
    codeSection,
  }) {
    let imports = importSection.map((imp: ParsedImport): Import => {
      if (imp.description.kind !== "function")
        return { ...imp, description: imp.description };
      let { kind, value: typeIdx } = imp.description;
      let description = { kind, value: typeSection[typeIdx] };
      return { ...imp, description };
    });
    let functions = funcSection.map((typeIdx, funcIdx) => {
      let type = typeSection[typeIdx];
      let { locals, body } = codeSection[funcIdx];
      return { index: funcIdx, type, locals, body };
    });
    let start =
      startSection === undefined ? undefined : functions[startSection];
    let [memory] = memorySection;
    return {
      imports,
      functions,
      memory,
      exports: exportSection,
      start,
    };
  },
});
