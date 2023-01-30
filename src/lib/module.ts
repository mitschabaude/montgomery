import { Binable } from "./binable.js";
import { Code, Func } from "./function.js";
import { U32, vec, withByteLength } from "./immediate.js";
import { FunctionType, MemoryType } from "./types.js";

export { Module };

type Module = {
  typeSection: TypeSection;
  funcSection: FuncSection;
  memorySection: MemoryType[];
  startSection?: Func;
  codeSection: CodeSection;
};
const emptyModule = {
  typeSection: [],
  funcSection: [],
  memorySection: [],
  codeSection: [],
  startSection: undefined,
} satisfies Module;

type TypeSection = FunctionType[];
const TypeSection = vec(FunctionType) satisfies Binable<TypeSection>;

type FuncSection = U32[];
const FuncSection = vec(U32) satisfies Binable<FuncSection>;

type CodeSection = Code[];
const CodeSection = vec(Code) satisfies Binable<CodeSection>;

type MemorySection = MemoryType[];
const MemorySection = vec(MemoryType) satisfies Binable<MemorySection>;

type StartSection = U32;
const StartSection = U32 satisfies Binable<StartSection>;

const sections = {
  // 0: CustomSection,
  1: TypeSection,
  // 2: ImportSection,
  3: FuncSection,
  // 4: TableSection,
  5: MemorySection,
  // 6: GlobalSection,
  // 7: ExportSection,
  8: StartSection,
  // 9: ElementSection,
  10: CodeSection,
  // 11: DataSection,
  // 12: DataCountSection,
};

type Sections = typeof sections;
type WithId<T extends Record<any, any>> = {
  [K in keyof T]: { id: K; content: T[K] extends Binable<infer U> ? U : never };
}[keyof T];
type Section = WithId<Sections>;

for (let id in sections) {
  sections[id as any as keyof Sections] = withByteLength(
    sections[id as any as keyof Sections] as any
  ) as any;
}

// const Section: Binable<Section> = Binable({
//   toBytes({ id, content }) {
//     let binable = sections[id];
//     return [id, ...binable.toBytes(content as any)];
//   },
//   readBytes(bytes, offset) {
//     let id = bytes[offset++] as keyof Sections;
//     if (id <= currentId) throw Error("invalid section id");
//     let section = sections[id] as WithContext<any, Binable<any>>;
//     if (section === undefined) throw Error("invalid section id");
//     let [content, end] = section(ctx).readBytes(bytes, offset);
//     return [{ id, content }, end] as any;
//   },
// });

// const Module: Binable<Module> = Binable({
// toBytes(t) {
//   let ctx = { ...emptyModule };
// },
// });
