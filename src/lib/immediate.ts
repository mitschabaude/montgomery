import { Binable } from "./binable.js";

export { vec, U32, I32, S33 };

type u32 = number;
type i32 = number;

function vec<T>(Element: Binable<T>) {
  return Binable<T[]>({
    toBytes(vec) {
      let length = U32.toBytes(vec.length);
      let elements = vec.map((t) => Element.toBytes(t));
      return length.concat(elements.flat());
    },
    readBytes(bytes, start) {
      let [length, offset] = U32.readBytes(bytes, start);
      let elements = [];
      for (let i = 0; i < length; i++) {
        let element: T;
        [element, offset] = Element.readBytes(bytes, offset);
        elements.push(element);
      }
      return [elements, offset];
    },
  });
}

const U32 = Binable<u32>({
  toBytes(x: u32) {
    return uLEB128(x);
  },
  readBytes(bytes, offset): [u32, number] {
    throw "todo";
  },
});

const I32 = Binable<i32>({
  toBytes(x: i32) {
    return sLEB128(x);
  },
  readBytes(bytes, offset): [i32, number] {
    throw "todo";
  },
});

const S33 = Binable<u32>({
  toBytes(x: u32) {
    return sLEB128(x);
  },
  readBytes(bytes, offset): [u32, number] {
    throw "todo";
  },
});

// https://en.wikipedia.org/wiki/LEB128#Unsigned_LEB128
function uLEB128(x0: bigint | number) {
  let x = BigInt(x0);
  let bytes = [];
  while (true) {
    let byte = Number(x & 0b0111_1111n); // low 7 bits
    x >>= 7n;
    if (x !== 0n) byte |= 0b1000_0000;
    bytes.push(byte);
    if (x === 0n) break;
  }
  return bytes;
}

function sLEB128(x0: bigint | number): number[] {
  throw "unimplemented";
}
