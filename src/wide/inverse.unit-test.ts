import { test } from "node:test";
import assert from "node:assert/strict";
import { Field } from "./field.ts";
import { exampleFields } from "../concrete/example-fields.ts";
import { inverse } from "../bigint/field.ts";
import { mod } from "../bigint/field-util.ts";
import { createEquivalentWasm, wasmSpec } from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";

for (const [label, BigintField] of Object.entries(exampleFields)) {
  test(`wide inverse: ${label}`, async () => {
    const F = await Field.create(BigintField.p);
    const W = F.Wasm;
    const equiv = createEquivalentWasm(F.Memory);
    const field = wasmSpec(F.Memory, Random.field(F.p), {
      size: F.sizeField,
      there: F.fromBigint,
      back: F.toBigint,
    });
    const lazy = wasmSpec(F.Memory, Random.uniformField(F.limit), {
      size: F.sizeField,
      there: F.writeBigint,
      back(ptr) {
        const value = F.readBigint(ptr);
        assert(value < F.limit);
        return mod(value, F.p);
      },
    });
    equiv(
      { from: [lazy], to: lazy, scratch: 3 },
      (a) => mod(BigintField.inverse(a) * F.R * F.R, F.p),
      ([scratch], out, a) => W.inverse(scratch, out, a),
      "inverse with lazy raw inputs"
    );
    const nearlyEqual = wasmSpec(
      F.Memory,
      Random.map(
        Random.tuple([Random.int(2, 7), Random.int(-25, 25)]),
        ([divisor, offset]) => mod(F.p / BigInt(divisor) + BigInt(offset), F.p)
      ),
      { size: F.sizeField, there: F.writeBigint, back: F.readBigint }
    );
    equiv(
      { from: [nearlyEqual], to: lazy, scratch: 3 },
      (a) => mod(BigintField.inverse(a) * F.R * F.R, F.p),
      ([scratch], out, a) => W.inverse(scratch, out, a),
      "fast inverse with nearly equal remainders"
    );
    equiv(
      { from: [field], to: field, scratch: 3 },
      BigintField.inverse,
      ([scratch], out, a) => W.inverseKaliski(scratch, out, a),
      "Kaliski reference"
    );
    equiv(
      { from: [field], to: field, scratch: 3 },
      BigintField.inverse,
      ([scratch], out, x) => W.inverse(scratch, out, x),
      "inverse"
    );
    equiv(
      { from: [field], to: field, scratch: 3 },
      BigintField.inverse,
      ([scratch], out, x) => {
        W.inverse(scratch, x, x);
        W.copy(out, x);
      },
      "inverse in place"
    );

    let count = 0;
    const array = wasmSpec(
      F.Memory,
      Random.array(
        Random.reject(Random.field(F.p), (x) => x === 0n),
        Random.nat(20)
      ),
      {
        size: 20 * F.sizeField,
        there(ptr, xs) {
          count = xs.length;
          xs.forEach((x, i) => F.fromBigint(ptr + i * F.sizeField, x));
        },
        back(ptr) {
          return Array.from({ length: count }, (_, i) =>
            F.toBigint(ptr + i * F.sizeField)
          );
        },
      }
    );
    equiv(
      { from: [array], to: array, scratch: 4 },
      (xs) => xs.map(BigintField.inverse),
      ([scratch], out, x) => W.batchInverse(scratch, out, x, count),
      "batch inverse"
    );

    const [scratch] = F.Memory.local.getPointers(1, 4 * F.sizeField);
    const [a, out] = F.Memory.local.getPointers(2);
    // Exercise whole-limb shifts in Kaliski's makeOdd, including a shift that ends odd.
    for (let bit = 64; bit < 64 * F.n; bit += 64) {
      const x = 1n << BigInt(bit);
      if (x >= F.limit) continue;
      F.writeBigint(a, x);
      W.inverse(scratch, out, a);
      assert.equal(F.toBigint(out), BigintField.inverse(F.toBigint(a)));
      W.inverseKaliski(scratch, out, a);
      assert.equal(F.toBigint(out), BigintField.inverse(F.toBigint(a)));
    }
    F.writeBigint(a, 0n);
    assert.throws(() => W.inverse(scratch, out, a), WebAssembly.RuntimeError);
    W.batchInverse(scratch, out, a, 0);
    assert.throws(
      () => W.batchInverse(scratch, out, a, 1),
      WebAssembly.RuntimeError
    );
  });
}

// Moduli bordering the thresholds where the multiplication and addition
// kernels drop their final reduction or extra carry limb.
const R128 = 1n << 128n;
for (const [label, p] of [
  ["below R/4", R128 / 4n - 1n],
  ["above R/4", R128 / 4n + 1n],
  ["below R/3", R128 / 3n - 2n],
  ["above R/3", R128 / 3n + 2n],
  ["below R/2", R128 / 2n - 1n],
  ["above R/2", R128 / 2n + 1n],
] as const) {
  test(`wide inverse at carry threshold: ${label}`, async () => {
    const F = await Field.create(p);
    const equiv = createEquivalentWasm(F.Memory);
    const lazy = wasmSpec(F.Memory, Random.uniformField(F.limit), {
      size: F.sizeField,
      there: F.writeBigint,
      back(ptr) {
        const value = F.readBigint(ptr);
        assert(value < F.limit);
        return mod(value, p);
      },
    });
    equiv(
      { from: [lazy], to: lazy, scratch: 3 },
      (a) => mod(inverse(a, p) * F.R * F.R, p),
      ([scratch], out, a) => F.Wasm.inverse(scratch, out, a),
      "inverse"
    );
  });
}

test("wide inverse rejects nonunits of a composite modulus", async () => {
  const F = await Field.create(15n);
  const [x, out] = F.Memory.local.getPointers(2);
  const scratch = F.Memory.local.getPointer(F.inverseScratchSize);
  for (const a of [0n, 3n, 5n, 6n, 9n, 10n, 12n, 15n]) {
    F.writeBigint(x, a);
    assert.throws(
      () => F.Wasm.inverse(scratch, out, x),
      WebAssembly.RuntimeError
    );
  }
  F.fromBigint(x, 2n);
  F.Wasm.inverse(scratch, out, x);
  assert.equal(F.toBigint(out), 8n);
});

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
