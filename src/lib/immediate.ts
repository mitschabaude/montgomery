import { Binable } from "./binable.js";

export { vec, withByteLength, U32, I32, S33 };

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

const U32 = Binable<u32>({
  toBytes(x: u32) {
    return toULEB128(x);
  },
  readBytes(bytes, offset): [u32, number] {
    let [x, end] = fromULEB128(bytes, offset);
    return [Number(x), end];
  },
});

const I32 = Binable<i32>({
  toBytes(x: i32) {
    return toSLEB128(x);
  },
  readBytes(bytes, offset): [i32, number] {
    let [x, end] = fromSLEB128(32, bytes, offset);
    return [Number(x), end];
  },
});

const S33 = Binable<u32>({
  toBytes(x: u32) {
    return toSLEB128(x);
  },
  readBytes(bytes, offset): [u32, number] {
    let [x, end] = fromSLEB128(33, bytes, offset);
    return [Number(x), end];
  },
});

// https://en.wikipedia.org/wiki/LEB128

function toULEB128(x0: bigint | number) {
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
function fromULEB128(bytes: number[], offset: number) {
  let x = 0n;
  let shift = 0n;
  while (true) {
    let byte = bytes[offset++];
    x |= BigInt(byte & 0b0111_1111) << shift;
    if ((byte & 0b1000_0000) === 0) break;
    shift += 7n;
  }
  return [x, offset] as [bigint, number];
}

function toSLEB128(x0: bigint | number): number[] {
  let x = BigInt(x0);
  let bytes = [];
  while (true) {
    let byte = Number(x & 0b0111_1111n);
    x >>= 7n;
    if (
      (x === 0n && (byte & 0b0100_0000) === 0) ||
      (x === -1n && (byte & 0b0100_0000) !== 0)
    ) {
      bytes.push(byte);
      return bytes;
    }
    bytes.push(byte | 0b1000_0000);
  }
}

function fromSLEB128(bitSize: number, bytes: number[], offset: number) {
  let x = 0n;
  let shift = 0n;
  let byte: number;
  while (true) {
    byte = bytes[offset++];
    x |= BigInt(byte & 0b0111_1111) << shift;
    shift += 7n;
    if ((byte & 0b1000_0000) === 0) break;
  }
  if (shift < bitSize && byte & 0b0100_0000) {
    x |= -1n << shift;
  }
  return [x, offset] as [bigint, number];
}
