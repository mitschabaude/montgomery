import { Binable } from "./binable.js";
import { CodeSection, FuncSection, TypeSection } from "./function.js";
import { U32, vec, withByteLength } from "./immediate.js";
import { MemoryType } from "./types.js";
import { BinableWithContext, WithContext } from "./with-context.js";

const MemorySection = BinableWithContext().return(vec(MemoryType));
const StartSection = BinableWithContext().return(U32);

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
  sections[id as any as keyof Sections] =
    BinableWithContext<any>().withByteLength<any>(
      sections[id as any as keyof Sections] as any
    ) as any;
}

const Section: Binable<Section> = Binable({
  toBytes(t) {
    return [t.id as number].concat(sections[t.id].toBytes(t.content as any));
  },
  readBytes(bytes, offset) {
    let id = bytes[offset++] as keyof Sections;
    let section = sections[id];
    if (section === undefined) throw Error("invalid section id");
    let [content, end] = section.readBytes(bytes, offset);
    return [{ id, content }, end] as any;
  },
});
