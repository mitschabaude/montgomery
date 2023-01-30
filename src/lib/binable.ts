export {
  Binable,
  tuple,
  record,
  iso,
  withByteCode,
  withPreamble,
  withValidation,
  Byte,
  Bool,
  Tuple,
  One,
  Zero,
  or,
  and,
  orUndefined,
  orDefault,
};

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

const Byte = Binable<number>({
  toBytes(b) {
    return [b];
  },
  readBytes(bytes, offset) {
    let byte = bytes[offset];
    return [byte, offset + 1];
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
    return [!!byte, offset + 1];
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

function withPreamble<T>(preamble: number[], binable: Binable<T>): Binable<T> {
  let length = preamble.length;
  return Binable({
    toBytes(t) {
      return preamble.concat(binable.toBytes(t));
    },
    readBytes(bytes, offset) {
      for (let i = 0; i < length; i++) {
        if (bytes[offset + i] !== preamble[i]) throw Error("invalid preamble");
      }
      return binable.readBytes(bytes, offset + length);
    },
  });
}

function withValidation<T>(binable: Binable<T>, validate: (t: T) => void) {
  return Binable<T>({
    toBytes(t) {
      validate(t);
      return binable.toBytes(t);
    },
    readBytes(bytes, offset) {
      let [t, end] = binable.readBytes(bytes, offset);
      validate(t);
      return [t, end];
    },
  });
}

type Tuple<T> = [T, ...T[]] | [];

type Union<T extends Tuple<any>> = T[number];

function record<Types extends Record<string, any>>(
  binables: {
    [i in keyof Types]-?: Binable<Types[i]>;
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

function iso<T, S>(
  binable: Binable<T>,
  { to, from }: { to(s: S): T; from(t: T): S }
): Binable<S> {
  return Binable({
    toBytes(s: S) {
      return binable.toBytes(to(s));
    },
    readBytes(bytes, offset) {
      let [value, end] = binable.readBytes(bytes, offset);
      return [from(value), end];
    },
  });
}

const Zero = Binable<unknown>({
  toBytes() {
    throw Error("can not write Zero");
  },
  readBytes() {
    throw Error("can not parse Zero");
  },
});
const One = Binable<undefined>({
  toBytes() {
    return [];
  },
  readBytes(_bytes, offset) {
    return [undefined, offset];
  },
});

const and = tuple;

function or<Types extends Tuple<any>>(
  binables: {
    [i in keyof Types]: Binable<Types[i]>;
  },
  distinguish: (t: Union<Types>) =>
    | {
        [i in keyof Types]: Binable<Types[i]>;
      }[number]
    | undefined
): Binable<Union<Types>> {
  return Binable({
    toBytes(value) {
      let binable = distinguish(value);
      if (binable === undefined)
        throw Error("or: input matches no allowed type");
      return binable.toBytes(value);
    },
    readBytes(bytes, offset) {
      let n = (binables as any[]).length;
      for (let i = 0; i < n; i++) {
        try {
          let [value, end] = binables[i].readBytes(bytes, offset);
          if (distinguish(value) === binables[i]) return [value, end];
        } catch {}
      }
      throw Error("or: could not parse any of the possible types");
    },
  });
}

function orUndefined<T>(binable: Binable<T>): Binable<T | undefined> {
  return or([binable, One], (value) => (value === undefined ? One : binable));
}

function orDefault<T>(binable: Binable<T>, defaultValue: T): Binable<T> {
  return iso(orUndefined(binable), {
    to: (t: T) => t,
    from: (t: T | undefined) => t ?? defaultValue,
  });
}
