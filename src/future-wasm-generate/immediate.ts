import { Binable } from "./binable.js";

export { vec, withByteLength, Name, U32, I32, I64, S33 };

type U32 = number;
type I32 = number;
type I64 = bigint;

function vec<T>(Element: Binable<T>) {
  return Binable<T[]>({
    toBytes(vec) {
      let length = U32.toBytes(vec.length);
      let elements = vec.map((t) => Element.toBytes(t));
      return length.concat(elements.flat());
    },
    readBytes(bytes, start) {
      let [length, offset] = U32.readBytes(bytes, start);
      let elements: T[] = [];
      for (let i = 0; i < length; i++) {
        let element: T;
        [element, offset] = Element.readBytes(bytes, offset);
        elements.push(element);
      }
      return [elements, offset];
    },
  });
}

const Name = Binable<string>({
  toBytes(string: string) {
    return [...U32.toBytes(string.length), ...new TextEncoder().encode(string)];
  },
  readBytes(bytes, start) {
    let [length, offset] = U32.readBytes(bytes, start);
    let end = offset + length;
    let stringBytes = Uint8Array.from(bytes.slice(offset, end));
    let string = new TextDecoder().decode(stringBytes);
    return [string, end];
  },
});

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

const U32 = Binable<U32>({
  toBytes(x: U32) {
    return toULEB128(x);
  },
  readBytes(bytes, offset): [U32, number] {
    let [x, end] = fromULEB128(bytes, offset);
    return [Number(x), end];
  },
});

const I32 = Binable<I32>({
  toBytes(x: I32) {
    return toSLEB128(x);
  },
  readBytes(bytes, offset): [I32, number] {
    let [x, end] = fromSLEB128(bytes, offset);
    return [Number(x), end];
  },
});

const I64 = Binable<I64>({
  toBytes(x: I64) {
    return toSLEB128(x);
  },
  readBytes(bytes, offset): [I64, number] {
    return fromSLEB128(bytes, offset);
  },
});

const S33 = Binable<U32>({
  toBytes(x: U32) {
    return toSLEB128(x);
  },
  readBytes(bytes, offset): [U32, number] {
    let [x, end] = fromSLEB128(bytes, offset);
    return [Number(x), end];
  },
});

// https://en.wikipedia.org/wiki/LEB128

function toULEB128(x0: bigint | number) {
  let x = BigInt(x0);
  let bytes: number[] = [];
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
  let bytes: number[] = [];
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

function fromSLEB128(bytes: number[], offset: number) {
  let x = 0n;
  let shift = 0n;
  let byte: number;
  while (true) {
    byte = bytes[offset++];
    x |= BigInt(byte & 0b0111_1111) << shift;
    shift += 7n;
    if ((byte & 0b1000_0000) === 0) break;
  }
  // on wikipedia, they say to check for (shift < bitSize) here (https://en.wikipedia.org/wiki/LEB128)
  // but that gives wrong results for numbers close to 2**(bitSize)..
  // the bit arithmetic of negative bigints seems to work as if they are infinite two's complements
  // e.g. -2n = ...111110, 1n = ...000001 and so we get -2n | 1n == ...111111 == -1n
  // so you never have to consider 'bit size'
  if (byte & 0b0100_0000) {
    x |= -1n << shift; // if negative, we OR with ...11110..0 to make the result a negative bigint
  }
  return [x, offset] as [bigint, number];
}
