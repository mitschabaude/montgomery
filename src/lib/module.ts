import { Binable, withByteCode } from "./binable.js";
import { U32 } from "./immediate.js";
import { invertRecord } from "./types.js";

const sections = {
  1: U32,
  2: U32,
};
const sectionToId = invertRecord(sections);

type Sections = typeof sections;
type WithId<T extends Record<any, any>> = {
  [K in keyof T]: { id: K; content: T[K] extends Binable<infer U> ? U : never };
}[keyof T];
type Section = WithId<Sections>;

const Section: Binable<Section> = Binable({
  toBytes(t) {
    return sections[t.id].toBytes(t.content);
  },
  readBytes(bytes, offset) {
    let id = bytes[offset++] as keyof Sections;
    let section = sections[id];
    if (section === undefined) throw Error("invalid section id");
    let [content, end] = section.readBytes(bytes, offset);
    return [{ id, content }, end];
  },
});

function section<T>(id: number, content: Binable<T>): Binable<T> {
  return withByteCode(id, withByteLength(content));
}

function withByteLength<T>(binable: Binable<T>): Binable<T> {
  return Binable({
    toBytes(t) {
      let bytes = binable.toBytes(t);
      return U32.toBytes(bytes.length).concat(bytes);
    },
    readBytes(bytes, offset) {
      let [length, start] = U32.readBytes(bytes, offset);
      let [value, end] = binable.readBytes(bytes, start);
      if (end !== start + length) throw Error("invalid length encoding");
      return [value, end];
    },
  });
}
