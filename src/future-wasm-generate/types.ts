import { Binable, Bool, record, withByteCode } from "./binable.js";
import { U32, vec } from "./immediate.js";

export { i32t, i64t, f32t, f64t, v128t, funcref, externref };
export { TypeIndex, FunctionIndex, MemoryIndex, TableIndex };
export {
  ValueTypeObject,
  RefTypeObject,
  FunctionType,
  MemoryType,
  GlobalType,
  TableType,
  ValueType,
  RefType,
  GenericValueType,
  invertRecord,
  valueType,
  valueTypeLiteral,
  valueTypeLiterals,
  functionTypeEquals,
  printFunctionType,
  JSValue,
};

type RefType = "funcref" | "externref";
type ValueType = "i32" | "i64" | "f32" | "f64" | "v128" | RefType;

type GenericValueType<L> = { kind: L };
function valueTypeLiteral<L extends ValueType>({ kind }: { kind: L }): L {
  return kind;
}
function valueType<L extends ValueType>(kind: L): GenericValueType<L> {
  return { kind };
}
function valueTypeLiterals<L extends ValueType[]>(types: {
  [i in keyof L]: GenericValueType<L[i]>;
}): ValueType[] {
  return types.map((t) => t.kind);
}

const valueTypeCodes: Record<ValueType, number> = {
  i32: 0x7f,
  i64: 0x7e,
  f32: 0x7d,
  f64: 0x7c,
  v128: 0x7b,
  funcref: 0x70,
  externref: 0x6f,
};
// type i32t = GenericValueType<"i32">;
// type i64t = GenericValueType<"i64">;
// type f32t = GenericValueType<"f32">;
// type f64t = GenericValueType<"f64">;
// type v128t = GenericValueType<"v128">;
// type funcref = GenericValueType<"funcref">;
// type externref = GenericValueType<"i64">;
const i32t = valueType("i32");
const i64t = valueType("i64");
const f32t = valueType("f32");
const f64t = valueType("f64");
const v128t = valueType("v128");
const funcref = valueType("funcref");
const externref = valueType("externref");

const codeToValueType = invertRecord(valueTypeCodes);

type ValueTypeObject = { kind: ValueType };
const ValueType = Binable<ValueType>({
  toBytes(type) {
    return [valueTypeCodes[type]];
  },
  readBytes(bytes, offset) {
    let code = bytes[offset++];
    let type = codeToValueType.get(code);
    if (type === undefined) throw Error("invalid value type");
    return [type, offset];
  },
});

type RefTypeObject = { kind: RefType };
const RefType = Binable<RefType>({
  toBytes(t) {
    return ValueType.toBytes(t);
  },
  readBytes(bytes, offset) {
    let [type, end] = ValueType.readBytes(bytes, offset);
    if (type !== "funcref" && type !== "externref")
      throw Error("invalid reftype");
    return [type, end];
  },
});

type GlobalType = { value: ValueType; mutable: boolean };
const GlobalType = record<GlobalType>({
  value: ValueType,
  mutable: Bool,
});

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

type ResultType = ValueType[];
const ResultType = vec(ValueType);

type FunctionType = { args: ResultType; results: ResultType };
const FunctionType = withByteCode(
  0x60,
  record<FunctionType>({ args: ResultType, results: ResultType })
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
    if (fArgs[i] !== gArgs[i]) return false;
  }
  for (let i = 0; i < nResults; i++) {
    if (fResults[i] !== gResults[i]) return false;
  }
  return true;
}

function printFunctionType({ args, results }: FunctionType) {
  return `${JSON.stringify(args)} -> ${JSON.stringify(results)}`;
}

// infer JS values

type JSValue<T extends ValueType> = T extends "i32"
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
