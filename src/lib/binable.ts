export { Binable, tuple, record, withByteCode, Empty, Bool, Tuple };

type Binable<T> = {
  toBytes(value: T): number[];
  readBytes(bytes: number[], offset: number): [value: T, offset: number];
  fromBytes(bytes: number[]): T;
};

function Binable<T>({
  toBytes,
  readBytes,
}: {
  toBytes(t: T): number[];
  readBytes(bytes: number[], offset: number): [value: T, offset: number];
}): Binable<T> {
  return {
    toBytes,
    readBytes,
    // spec: fromBytes throws if the input bytes are not all used
    fromBytes(bytes) {
      let [value, offset] = readBytes(bytes, 0);
      if (offset < bytes.length)
        throw Error("fromBytes: input bytes left over");
      return value;
    },
  };
}

const Empty = Binable<null>({
  toBytes(_t) {
    return [];
  },
  readBytes(_bytes, offset) {
    return [null, offset];
  },
});
const Bool = Binable<boolean>({
  toBytes(b) {
    return [Number(b)];
  },
  readBytes(bytes, offset) {
    let byte = bytes[offset];
    if (byte !== 0 && byte !== 1) {
      throw Error("not a valid boolean");
    }
    return [!!byte, offset++];
  },
});

function withByteCode<T>(code: number, binable: Binable<T>): Binable<T> {
  return Binable({
    toBytes(t) {
      return [code].concat(binable.toBytes(t));
    },
    readBytes(bytes, offset) {
      if (bytes[offset++] !== code) throw Error("invalid start byte");
      return binable.readBytes(bytes, offset);
    },
  });
}

type Tuple<T> = [T, ...T[]] | [];

function record<Types extends Record<string, any>>(
  binables: {
    [i in keyof Types]: Binable<Types[i]>;
  },
  keys: Tuple<keyof Types>
): Binable<Types> {
  let binablesTuple = keys.map((key) => binables[key]) as Tuple<Binable<any>>;
  let tupleBinable = tuple<Tuple<any>>(binablesTuple);
  return Binable({
    toBytes(t) {
      let array = keys.map((key) => t[key]) as Tuple<any>;
      return tupleBinable.toBytes(array);
    },
    readBytes(bytes, start) {
      let [tupleValue, end] = tupleBinable.readBytes(bytes, start);
      let value = Object.fromEntries(
        keys.map((key, i) => [key, tupleValue[i]])
      ) as any;
      return [value, end];
    },
  });
}

function tuple<Types extends Tuple<any>>(binables: {
  [i in keyof Types]: Binable<Types[i]>;
}): Binable<Types> {
  let n = (binables as any[]).length;
  return Binable({
    toBytes(t) {
      let bytes: number[] = [];
      for (let i = 0; i < n; i++) {
        let subBytes = binables[i].toBytes(t[i]);
        bytes.push(...subBytes);
      }
      return bytes;
    },
    readBytes(bytes, offset) {
      let values = [];
      for (let i = 0; i < n; i++) {
        let [value, newOffset] = binables[i].readBytes(bytes, offset);
        offset = newOffset;
        values.push(value);
      }
      return [values as Types, offset];
    },
  });
}
