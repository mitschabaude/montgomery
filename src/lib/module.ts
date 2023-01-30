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

export { Module };

type Module = {
  functions: Func[];
  memory?: MemoryType;
  start?: Func;
};

type ParsedModule = {
  version: number;
  typeSection: TypeSection;
  funcSection: FuncSection;
  memorySection: MemorySection;
  startSection?: StartSection;
  codeSection: CodeSection;
};

type TypeSection = FunctionType[];
let TypeSection = vec(FunctionType) satisfies Binable<TypeSection>;

type FuncSection = U32[];
let FuncSection = vec(U32) satisfies Binable<FuncSection>;

type CodeSection = Code[];
let CodeSection = vec(Code) satisfies Binable<CodeSection>;

type MemorySection = MemoryType[];
let MemorySection = vec(MemoryType) satisfies Binable<MemorySection>;

type StartSection = U32;
let StartSection = U32 satisfies Binable<StartSection>;

// 0: CustomSection,
// 1: TypeSection,
// 2: ImportSection,
// 3: FuncSection,
// 4: TableSection,
// 5: MemorySection,
// 6: GlobalSection,
// 7: ExportSection,
// 8: StartSection,
// 9: ElementSection,
// 10: CodeSection,
// 11: DataSection,
// 12: DataCountSection,

TypeSection = withByteCode(1, withByteLength(TypeSection));
FuncSection = withByteCode(3, withByteLength(FuncSection));
MemorySection = withByteCode(5, withByteLength(MemorySection));
StartSection = withByteCode(8, withByteLength(StartSection));
CodeSection = withByteCode(10, withByteLength(CodeSection));

const Version = iso(tuple([Byte, Byte, Byte, Byte]), {
  to(n: number) {
    return [n, 0x00, 0x00, 0x00];
  },
  from([n0, n1, n2, n3]) {
    if (n1 || n2 || n3) throw Error("invalid version");
    return n0;
  },
});

let ParsedModule = withPreamble(
  [0x00, 0x61, 0x73, 0x6d],
  record<ParsedModule>(
    {
      version: Version,
      typeSection: orDefault(TypeSection, []),
      funcSection: orDefault(FuncSection, []),
      memorySection: orDefault(MemorySection, []),
      startSection: orUndefined(StartSection),
      codeSection: orDefault(CodeSection, []),
    },
    [
      "version",
      "typeSection",
      "funcSection",
      "memorySection",
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
    if (startSection && !funcSection.includes(startSection)) {
      throw Error("start function index must be included in function section");
    }
  }
);

const Module = iso<ParsedModule, Module>(ParsedModule, {
  to({ functions, memory, start }) {
    // TODO imports go at the start of type section
    let typeSection = functions.map((f) => f.type);
    let funcSection = typeSection.map((_, i) => i);
    let memorySection = memory ? [memory] : [];
    let startSection = start && functions.indexOf(start);
    if (startSection === -1) {
      throw Error("start function is not included in functions");
    }
    let codeSection = functions.map(({ locals, body }) => ({ locals, body }));
    return {
      version: 1,
      typeSection,
      funcSection,
      memorySection,
      startSection,
      codeSection,
    };
  },
  from({ typeSection, funcSection, memorySection, startSection, codeSection }) {
    let functions = funcSection.map((typeIdx, funcIdx) => {
      let type = typeSection[typeIdx];
      let { locals, body } = codeSection[funcIdx];
      return { index: funcIdx, type, locals, body };
    });
    let start =
      startSection === undefined ? undefined : functions[startSection];
    let [memory] = memorySection;
    return { functions, start, memory };
  },
});
