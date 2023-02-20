import { Undefined } from "./binable.js";
import { I32 } from "./immediate.js";
import { simpleInstruction } from "./instruction-base.js";
import { i32t, i64t, f32t, f64t } from "./types.js";

export { i32, i64, f32, f64 };

type i32 = i32t;
type i64 = i64t;
type f32 = f32t;
type f64 = f64t;

const i32 = Object.assign(i32t, {
  const: simpleInstruction("i32.const", I32, { out: [i32t] }),
  add: simpleInstruction("i32.add", Undefined, {
    in: [i32t, i32t],
    out: [i32t],
  }),
});
