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
import { ConstExpression, Expression } from "./instruction.js";
import {
  funcref,
  FunctionIndex,
  GlobalType,
  RefType,
  TableIndex,
} from "./types.js";

export { Global, Data, Elem };

type Global = { type: GlobalType; init: ConstExpression };
const Global = record<Global>({ type: GlobalType, init: ConstExpression }, [
  "type",
  "init",
]);

type Data = { init: Byte[]; active?: { memory: U32; offset: ConstExpression } };

const Offset0 = record({ memory: constant<0>(0), offset: ConstExpression }, [
  "memory",
  "offset",
]);
const Offset = record({ memory: U32, offset: ConstExpression }, [
  "memory",
  "offset",
]);

type ActiveData = {
  init: Byte[];
  active: { memory: 0; offset: ConstExpression };
};
const ActiveData = record({ active: Offset0, init: vec(Byte) }, [
  "active",
  "init",
]);

type PassiveData = { init: Byte[] };
const PassiveData = named({ init: vec(Byte) });

type ActiveDataMultiMemory = {
  active: { memory: U32; offset: ConstExpression };
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

type Elem = {
  type: RefType;
  init: Expression[];
  mode: "passive" | "declarative" | { table: U32; offset: ConstExpression };
};

type FunctionIndices = FunctionIndex[];
const FunctionIndices = vec(FunctionIndex);
type Expressions = Expression[];
const Expressions = vec(Expression);

function fromFuncIdx(funcIdx: FunctionIndices): Expressions {
  return funcIdx.map((i) => [{ string: "ref.func", immediate: i }]);
}
function toFuncIdx(expr: Expressions) {
  return expr.map((e) => e[0].immediate as FunctionIndex);
}
function isFuncIdx(expr: Expressions) {
  return expr.every((e) => e.length === 1 && e[0].string === "ref.func");
}

const Elem = Binable<Elem>({
  toBytes({ type, init, mode }) {
    // write code
    let isPassive = Number(typeof mode === "string");
    let isExplicit = Number(!(type.kind === "funcref" && isFuncIdx(init)));
    let isBit1 = Number(
      typeof mode !== "string"
        ? mode.table !== 0 && !isExplicit
        : mode === "declarative"
    );
    let bytes = U32.toBytes(
      (isPassive << 0) & (isBit1 << 1) & (isExplicit << 2)
    );
    // in active mode, write table and offset
    if (typeof mode !== "string") {
      let table = isBit1 ? TableIndex.toBytes(mode.table) : [];
      let offset = Expression.toBytes(mode.offset);
      bytes.push(...table, ...offset);
    }
    // write type
    let typeBytes =
      isPassive | isBit1 ? (isExplicit ? RefType.toBytes(type) : [0x00]) : [];
    bytes.push(...typeBytes);
    // write init
    let initBytes = isExplicit
      ? Expressions.toBytes(init)
      : FunctionIndices.toBytes(toFuncIdx(init));
    bytes.push(...initBytes);
    return bytes;
  },
  readBytes(bytes, offset) {
    let code: number;
    [code, offset] = U32.readBytes(bytes, offset);
    let [isPassive, isBit1, isExplicit] = [code & 1, code & 2, code & 4];
    // parse mode / table / offset
    let mode: Elem["mode"];
    if (isPassive) mode = isBit1 ? "declarative" : "passive";
    else {
      let table: TableIndex = 0;
      let tableOffset: ConstExpression;
      if (isBit1) [table, offset] = TableIndex.readBytes(bytes, offset);
      [tableOffset, offset] = ConstExpression.readBytes(bytes, offset);
      mode = { table, offset: tableOffset };
    }
    // parse type
    let type: RefType = funcref;
    if (isPassive | isBit1) {
      if (isExplicit) [type, offset] = RefType.readBytes(bytes, offset);
      else if (bytes[offset++] !== 0x00) throw Error("Elem: invalid elemkind");
    }
    // parse init
    let init: Expressions;
    if (isExplicit) [init, offset] = Expressions.readBytes(bytes, offset);
    else {
      let idx: FunctionIndices;
      [idx, offset] = FunctionIndices.readBytes(bytes, offset);
      init = fromFuncIdx(idx);
    }
    return [{ mode, type, init }, offset];
  },
});

function withU32<T>(code: number, binable: Binable<T>): Binable<T> {
  return second(
    code,
    withValidation(tuple([U32, binable]), ([code_]) => {
      if (code !== code_)
        throw Error(`invalid u32 code, expected ${code}, got ${code_}`);
    })
  );
}

function second<F, S>(first: F, tuple: Binable<[F, S]>): Binable<S> {
  return iso<[F, S], S>(tuple, {
    to: (second) => [first, second],
    from: ([, second]) => second,
  });
}
