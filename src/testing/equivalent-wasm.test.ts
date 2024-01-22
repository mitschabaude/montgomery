import { create } from "../concrete/pasta.parallel.js";
import { createEquivalentWasm, WasmSpec } from "./equivalent-wasm.js";
import { createField } from "../bigint/field.js";

let { Field } = await create();
let BigintField = createField(Field.p);

const field = WasmSpec.field(Field);

const equiv = createEquivalentWasm(Field, { verbose: true });

equiv(
  { from: [field, field], to: field },
  BigintField.mul,
  Field.multiply,
  "multiply"
);

equiv(
  { from: [field], to: WasmSpec.boolean },
  (x) => BigintField.equal(x, 0n),
  Field.isZero,
  "isZero"
);
