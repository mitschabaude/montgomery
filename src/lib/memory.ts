import {
  Binable,
  Byte,
  constant,
  iso,
  named,
  or,
  record,
  tuple,
  withValidation,
} from "./binable.js";
import { U32, vec } from "./immediate.js";
import { Expression } from "./instruction.js";
import { GlobalType } from "./types.js";

export { Global, Data };

type Global = { type: GlobalType; init: Expression };
const Global = record<Global>({ type: GlobalType, init: Expression }, [
  "type",
  "init",
]);

function withU32<T>(code: number, binable: Binable<T>): Binable<T> {
  return iso<[U32, T], T>(
    withValidation(tuple([U32, binable]), ([code_]) => {
      if (code !== code_)
        throw Error(`invalid u32 code, expected ${code}, got ${code_}`);
    }),
    { to: (t) => [code, t], from: ([, t]) => t }
  );
}

type Data = { init: Byte[]; active?: { memory: U32; offset: Expression } };

const Offset0 = record({ memory: constant<0>(0), offset: Expression }, [
  "memory",
  "offset",
]);
const Offset = record({ memory: U32, offset: Expression }, [
  "memory",
  "offset",
]);

type ActiveData = { init: Byte[]; active: { memory: 0; offset: Expression } };
const ActiveData = record({ active: Offset0, init: vec(Byte) }, [
  "active",
  "init",
]);

type PassiveData = { init: Byte[] };
const PassiveData = named({ init: vec(Byte) });

type ActiveDataMultiMemory = {
  active: { memory: U32; offset: Expression };
  init: Byte[];
};
const ActiveDataMultiMemory = record({ active: Offset, init: vec(Byte) }, [
  "active",
  "init",
]);

const Data: Binable<Data> = or(
  [
    withU32(0, ActiveData),
    withU32(1, PassiveData),
    withU32(2, ActiveDataMultiMemory),
  ],
  (t: Data) =>
    t.active === undefined
      ? PassiveData
      : t.active.memory === 0
      ? ActiveData
      : ActiveDataMultiMemory
);
