import { Binable, iso } from "./binable.js";
import { CodeSection, Func, FuncSection, TypeSection } from "./function.js";
import { U32, vec } from "./immediate.js";
import { MemoryType } from "./types.js";
import { BinableWithContext, WithContext } from "./with-context.js";

export { Module };

type Module = {
  typeSection: TypeSection;
  funcSection: FuncSection;
  memorySection: MemoryType[];
  startSection?: Func;
  codeSection: CodeSection;
};

const emptyModule: Module = {
  typeSection: [],
  funcSection: [],
  memorySection: [],
  codeSection: [],
  startSection: undefined,
};

const EmptyContext = BinableWithContext<undefined>();
const AnyContext = BinableWithContext<any>();

const MemorySection = EmptyContext.return(vec(MemoryType));
const StartSection: WithContext<
  { codeSection: CodeSection },
  Binable<Func>
> = ({ codeSection }) =>
  iso(U32, {
    to(func) {
      return func.index;
    },
    from(index) {
      return codeSection[index];
    },
  });

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
  [K in keyof T]: {
    id: K;
    content: T[K] extends WithContext<any, Binable<infer U>> ? U : never;
  };
}[keyof T];
type Section = WithId<Sections>;

for (let id in sections) {
  sections[id as any as keyof Sections] = AnyContext.withByteLength(
    sections[id as any as keyof Sections] as any
  ) as any;
}

const Section: WithContext<
  { currentId: number; ctx: any },
  Binable<Section>
> = ({ currentId, ctx }) =>
  Binable({
    toBytes({ id, content }) {
      let binable = (sections[id] as WithContext<any, Binable<any>>)(ctx);
      return [id, ...binable.toBytes(content as any)];
    },
    readBytes(bytes, offset) {
      let id = bytes[offset++] as keyof Sections;
      if (id <= currentId) throw Error("invalid section id");
      let section = sections[id] as WithContext<any, Binable<any>>;
      if (section === undefined) throw Error("invalid section id");
      let [content, end] = section(ctx).readBytes(bytes, offset);
      return [{ id, content }, end] as any;
    },
  });

// const Module: Binable<Module> = Binable({
// toBytes(t) {
//   let ctx = { ...emptyModule };
// },
// });
