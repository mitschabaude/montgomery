import { Binable, Bool, record, withByteCode } from "./binable.js";
import { U32, vec } from "./immediate.js";

export { i32t, i64t, f32t, f64t, funcref, externref };
export {
  ValueType,
  FunctionType,
  MemoryType,
  GlobalType,
  TableType,
  JSValue,
  ValueTypeLiteral,
  invertRecord,
  valueType,
  valueTypes,
};

type RefTypeLiteral = "funcref" | "externref";
type ValueTypeLiteral = "i32" | "i64" | "f32" | "f64" | "v128" | RefTypeLiteral;

type JSValue<T extends ValueType> = JSValueFromLiteral<T["kind"]>;
type JSValueFromLiteral<T extends ValueTypeLiteral> = T extends "i32"
  ? number
  : T extends "f32"
  ? number
  : T extends "f64"
  ? number
  : T extends "i64"
  ? bigint
  : T extends "funcref"
  ? Function
  : T extends "externref"
  ? any
  : any;

type Type<L> = { kind: L };
function valueType<L extends ValueTypeLiteral>(kind: L): Type<L> {
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
type i32t = Type<"i32">;
type i64t = Type<"i64">;
type f32t = Type<"f32">;
type f64t = Type<"f64">;
type funcref = Type<"funcref">;
type externref = Type<"i64">;
const i32t = valueType("i32");
const i64t = valueType("i64");
const f32t = valueType("f32");
const f64t = valueType("f64");
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
const GlobalType = record<GlobalType>({ value: ValueType, mutable: Bool }, [
  "value",
  "mutable",
]);

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
const MemoryType = record<MemoryType>({ limits: Limits }, ["limits"]);

type TableType = { limits: Limits; element: RefType };
const TableType = record<TableType>({ element: RefType, limits: Limits }, []);

type FunctionType = { args: ValueType[]; results: ValueType[] };
const FunctionType = withByteCode(
  0x60,
  record<FunctionType>({ args: vec(ValueType), results: vec(ValueType) }, [
    "args",
    "results",
  ])
);

function invertRecord<K extends string, V>(record: Record<K, V>): Map<V, K> {
  let map = new Map<V, K>();
  for (let key in record) {
    map.set(record[key], key);
  }
  return map;
}
