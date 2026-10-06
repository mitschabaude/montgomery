import { test } from "node:test";
import assert from "node:assert/strict";
import { Field } from "./field.ts";
import { exampleFields } from "../concrete/example-fields.ts";
import { createEquivalentWasm, wasmSpec } from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";
import { mod } from "../bigint/field-util.ts";

// These inputs produce negative full remainders despite positive high-bit
// approximations. Keep exact regressions alongside the randomized properties.
const signFlips = {
  pastaFp: [2n, -24n],
  secp256k1: [3n, -18n],
  bn254Scalar: [3n, 3n],
  bls12377: [3n, 3n],
} as const;
for (const [label, [divisor, offset]] of Object.entries(signFlips)) {
  test(`wide fast inverse sign correction: ${label}`, async () => {
    const B = exampleFields[label as keyof typeof exampleFields];
    const F = await Field.create(B.p);
    const [a, out] = F.Memory.local.getPointers(2);
    const scratch = F.Memory.local.getPointer(F.inverseScratchSize);
    const guard = F.Memory.local.getPointer();
    const input = F.p / divisor + offset;
    F.writeBigint(guard, 17n);
    F.writeBigint(a, input);
    F.Wasm.inverse(scratch, out, a);
    assert.equal(F.toBigint(out), B.inverse(F.toBigint(a)));
    assert.equal(F.readBigint(a), input);
    F.Wasm.inverse(scratch, a, a);
    assert.equal(F.readBigint(a), F.readBigint(out));
    assert.equal(F.readBigint(guard), 17n);
  });
}

for (const label of [
  "pastaFp",
  "goldilocks",
  "secp256k1",
  "bn254Scalar",
  "bls12377",
] as const) {
  test(`wide fast inverse uniform inputs: ${label}`, async () => {
    const B = exampleFields[label];
    const F = await Field.create(B.p);
    const equiv = createEquivalentWasm(F.Memory, {
      minRuns: 2000,
      maxRuns: 2000,
    });
    const raw = wasmSpec(F.Memory, Random.uniformField(F.limit), {
      size: F.sizeField,
      there: F.writeBigint,
      back(ptr) {
        const value = F.readBigint(ptr);
        assert(value < F.limit);
        return mod(value, F.p);
      },
    });
    equiv(
      { from: [raw], to: raw, scratch: 3 },
      (a) => mod(B.inverse(a) * F.R * F.R, F.p),
      ([scratch], out, a) => F.Wasm.inverse(scratch, out, a),
      "complete fast Montgomery inverse"
    );
  });
}
