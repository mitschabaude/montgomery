import { pallasParams } from "../concrete/pasta.params.js";
import { Random } from "../testing/random.js";
import {
  createEquivalentWasm,
  wasmSpec,
  WasmSpec,
} from "../testing/equivalent-wasm.js";
import { Field } from "./field.js";
import { createField as createFieldBigint } from "../bigint/field.js";

let p = pallasParams.modulus;

const Fp = await Field.create(p);
const FpWasm = Fp.Wasm;
const FpBigint = createFieldBigint(p);
let Local = Fp.Memory.local;

// partial reduce: matches what `add` / `reduce` do (check top limb vs p[4])
function reduce(x: bigint) {
  return x >> 204n <= p >> 204n ? x : x - p;
}

// property tests

let equiv = createEquivalentWasm(Fp.Memory, { logSuccess: true });
let fieldRng = Random.field(p);
let fieldWeaklyReducedRng = Random.map(Random.bignat(1n << 204n), (u) => p + u);
let fieldLessThan2pRng = Random.bignat(2n * p);

let field = wasmSpec(Fp.Memory, fieldRng, {
  size: Fp.sizeSingle,
  there: (xPtr, x) => Fp.writeSingle(xPtr, x),
  back: (x) => Fp.readSingle(x),
});
let fieldWeaklyReduced = wasmSpec(Fp.Memory, fieldWeaklyReducedRng, {
  size: Fp.sizeSingle,
  there: (xPtr, x) => Fp.writeSingle(xPtr, x),
  back: (x) => Fp.readSingle(x),
});
let fieldLessThan2p = wasmSpec(Fp.Memory, fieldLessThan2pRng, {
  size: Fp.sizeSingle,
  there: (xPtr, x) => Fp.writeSingle(xPtr, x),
  back: (x) => Fp.readSingle(x),
});

let fieldRaw = wasmSpec(Fp.Memory, fieldRng, {
  size: Fp.sizeSingle,
  there: (xPtr, x) => Fp.writeSingle(xPtr, x),
  back: (x) => Fp.readSingleRaw(x),
});

equiv(
  { from: [field], to: field },
  (x) => x,
  (out, x) => Fp.copy(out, x),
  "wasm roundtrip",
);

equiv(
  { from: [field, field], to: field },
  (x, y) => reduce(x + y),
  FpWasm.add,
  "add",
);

equiv(
  { from: [field, field], to: field },
  FpBigint.subtract,
  FpWasm.sub,
  "sub",
);

equiv(
  { from: [field, fieldWeaklyReduced], to: field },
  (x, y) => FpBigint.mod(x - y),
  FpWasm.sub,
  "sub: x - y + p < 0",
);

// addRaw: limb-wise add, no carry. limbs may exceed 2^51, read with readSingleRaw.
equiv(
  { from: [field, field], to: fieldRaw },
  (x, y) => x + y,
  FpWasm.addRaw,
  "addRaw",
);

// addCarry: carry-propagated add, no reduce. output in [0, 2p) fits 5 positive 51-bit limbs.
equiv(
  { from: [field, field], to: field },
  (x, y) => x + y,
  FpWasm.addCarry,
  "addCarry",
);

// subRaw: limb-wise sub, no carry. limbs can be negative, read with readSingleRaw.
equiv(
  { from: [field, field], to: fieldRaw },
  (x, y) => x - y,
  FpWasm.subRaw,
  "subRaw",
);

// subCarry: carry-propagated sub, no conditional +p. readSingle with signed top limb
// correctly recovers signed 255-bit value.
equiv(
  { from: [field, field], to: field },
  (x, y) => x - y,
  FpWasm.subCarry,
  "subCarry",
);

// reduce: in-place. x with x[4] > p[4] gets -= p, else unchanged.
equiv(
  { from: [fieldWeaklyReduced], to: field },
  reduce,
  (out, x) => {
    Fp.copySingle(out, x);
    FpWasm.reduce(out);
  },
  "reduce",
);

// fullyReduce: in-place. x in [0, 2p), output in [0, p).
equiv(
  { from: [fieldLessThan2p], to: field },
  (x) => FpBigint.mod(x),
  (out, x) => {
    Fp.copySingle(out, x);
    FpWasm.fullyReduce(out);
  },
  "fullyReduce",
);

// wasm copy (as opposed to the JS-level Fp.copy used above in "wasm roundtrip")
equiv({ from: [field], to: field }, (x) => x, FpWasm.copy, "wasm copy");

equiv(
  { from: [field, field], to: WasmSpec.boolean },
  (x, y) => x === y,
  FpWasm.isEqual,
  "isEqual: unequal inputs",
);

// isEqual with equal inputs: generate x, pass (x, x)
equiv(
  { from: [field], to: WasmSpec.boolean },
  (_x) => true,
  (x) => FpWasm.isEqual(x, x),
  "isEqual: equal inputs",
);

equiv(
  { from: [field], to: WasmSpec.boolean },
  (x) => x === 0n,
  FpWasm.isZero,
  "isZero: random inputs",
);

// isZero on a deliberately-zeroed buffer
{
  let zeroPtr = Local.getPointer(Fp.sizeSingle);
  Fp.writeSingle(zeroPtr, 0n);
  if (FpWasm.isZero(zeroPtr) !== 1) throw Error("isZero: zero buffer");
}

// isGreater: fully-reduced inputs, signed limb compare matches bigint >
equiv(
  { from: [field, field], to: WasmSpec.boolean },
  (x, y) => x > y,
  FpWasm.isGreater,
  "isGreater",
);
