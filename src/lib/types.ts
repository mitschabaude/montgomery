import { Binable, Bool, record, withByteCode } from "./binable.js";
import { U32, vec } from "./immediate.js";

export { i32t, i64t, f32t, f64t, v128t, funcref, externref };
export { TypeIndex, FunctionIndex, MemoryIndex, TableIndex };
export {
  ValueType,
  RefType,
  FunctionType,
  MemoryType,
  GlobalType,
  TableType,
  ValueTypeLiteral,
  GenericValueType,
  invertRecord,
  valueType,
  valueTypes,
  functionTypeEquals,
  JSValue,
};

type RefTypeLiteral = "funcref" | "externref";
type ValueTypeLiteral = "i32" | "i64" | "f32" | "f64" | "v128" | RefTypeLiteral;

type GenericValueType<L> = { kind: L };
function valueType<L extends ValueTypeLiteral>(kind: L): GenericValueType<L> {
  return { kind };
}

const valueTypes: Record<ValueTypeLiteral, number> = {
  i32: 0x7f,
  i64: 0x7e,
  f32: 0x7d,
  f64: 0x7c,
  v128: 0x7b,
  funcref: 0x70,
  externref: 0x6f,
};
type i32t = GenericValueType<"i32">;
type i64t = GenericValueType<"i64">;
type f32t = GenericValueType<"f32">;
type f64t = GenericValueType<"f64">;
type v128t = GenericValueType<"v128">;
type funcref = GenericValueType<"funcref">;
type externref = GenericValueType<"i64">;
const i32t = valueType("i32");
const i64t = valueType("i64");
const f32t = valueType("f32");
const f64t = valueType("f64");
const v128t = valueType("v128");
const funcref = valueType("funcref");
const externref = valueType("externref");

const codeToValueType = invertRecord(valueTypes);

type ValueType = { kind: ValueTypeLiteral };
const ValueType: Binable<ValueType> = Binable({
  toBytes(type) {
    return [valueTypes[type.kind]];
  },
  readBytes(bytes, offset) {
    let code = bytes[offset++];
    let literal = codeToValueType.get(code);
    if (literal === undefined) throw Error("invalid value type");
    return [{ kind: literal }, offset];
  },
});

type RefType = { kind: RefTypeLiteral };
const RefType: Binable<RefType> = Binable<RefType>({
  toBytes(t) {
    return ValueType.toBytes(t);
  },
  readBytes(bytes, offset) {
    let [{ kind }, end] = ValueType.readBytes(bytes, offset);
    if (kind !== "funcref" && kind !== "externref")
      throw Error("invalid reftype");
    return [{ kind }, end];
  },
});

type GlobalType = { value: ValueType; mutable: boolean };
const GlobalType = record<GlobalType>({ value: ValueType, mutable: Bool });

type Limits = { min: number; max?: number };
const Limits = Binable<Limits>({
  toBytes({ min, max }) {
    if (max === undefined) return [0x00, ...U32.toBytes(min)];
    return [0x01, ...U32.toBytes(min), ...U32.toBytes(max)];
  },
  readBytes(bytes, offset) {
    let hasMax: boolean, min: number, max: number | undefined;
    [hasMax, offset] = Bool.readBytes(bytes, offset);
    [min, offset] = U32.readBytes(bytes, offset);
    if (hasMax) {
      [max, offset] = U32.readBytes(bytes, offset);
    }
    return [{ min, max }, offset];
  },
});

type MemoryType = { limits: Limits };
const MemoryType = record<MemoryType>({ limits: Limits });

type TableType = { type: RefType; limits: Limits };
const TableType = record<TableType>({ type: RefType, limits: Limits });

type FunctionType = {
  args: ValueType[];
  results: ValueType[];
};
const FunctionType = withByteCode(
  0x60,
  record<FunctionType>({ args: vec(ValueType), results: vec(ValueType) })
);

type TypeIndex = U32;
const TypeIndex = U32;
type FunctionIndex = U32;
const FunctionIndex = U32;
type TableIndex = U32;
const TableIndex = U32;
type MemoryIndex = U32;
const MemoryIndex = U32;

function invertRecord<K extends string, V>(record: Record<K, V>): Map<V, K> {
  let map = new Map<V, K>();
  for (let key in record) {
    map.set(record[key], key);
  }
  return map;
}

function functionTypeEquals(
  { args: fArgs, results: fResults }: FunctionType,
  { args: gArgs, results: gResults }: FunctionType
) {
  let nArgs = fArgs.length;
  let nResults = fResults.length;
  if (gArgs.length !== nArgs || gResults.length !== nResults) return false;
  for (let i = 0; i < nArgs; i++) {
    if (fArgs[i].kind !== gArgs[i].kind) return false;
  }
  for (let i = 0; i < nResults; i++) {
    if (fResults[i].kind !== gResults[i].kind) return false;
  }
  return true;
}

// infer JS values

type JSValue<T extends ValueType> = JSValueFromLiteral<T["kind"]>;

type JSValueFromLiteral<T extends ValueTypeLiteral> = T extends "i32"
  ? number
  : T extends "f32"
  ? number
  : T extends "f64"
  ? number
  : T extends "i64"
  ? bigint
  : T extends "v128"
  ? bigint
  : T extends "funcref"
  ? Function | null
  : T extends "externref"
  ? any
  : any;
