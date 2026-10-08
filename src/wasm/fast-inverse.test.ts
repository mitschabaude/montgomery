import { test } from "node:test";
import assert from "node:assert/strict";
import { Module, memory } from "wasmati";
import { exampleFields } from "../concrete/example-fields.ts";
import { FieldWithArithmetic } from "./field-arithmetic.ts";
import { multiplyMontgomery } from "./multiply-montgomery.ts";
import { fastInverse } from "./fast-inverse.ts";
import { inverseKaliski } from "./inverse.ts";
import { ImplicitMemory } from "./wasm-util.ts";
import { memoryHelpers } from "./memory-helpers.ts";
import { montgomeryParams, mod } from "../bigint/field-util.ts";
import { createEquivalentWasm, wasmSpec } from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";
import { inverse as bigintInverse } from "../bigint/field.ts";

for (const [label, B] of [
  ...Object.entries(exampleFields),
  [
    "composite15",
    { p: 15n, inverse: (a: bigint) => bigintInverse(a, 15n) },
  ] as const,
]) {
  test(`29-bit fast inverse: ${label}`, async () => {
    const w = 29;
    const n = Math.max(2, montgomeryParams(B.p, w).n);
    const mem = new ImplicitMemory(memory({ min: 100 }));
    const F = {
      ...FieldWithArithmetic(B.p, w, n),
      ...multiplyMontgomery(B.p, w, n, { countMultiplications: false }),
    };
    const { inverse } = fastInverse(mem, F);
    const module = Module({
      exports: {
        ...mem.getExports(),
        inverse,
        inverseKaliski: inverseKaliski(mem, F),
      },
    });
    const W = (await module.instantiate()).instance.exports;
    const H = memoryHelpers(B.p, w, n, W);
    const equiv = createEquivalentWasm(H);
    const raw = wasmSpec(H, Random.fieldx2(B.p), {
      size: F.size,
      there: H.writeBigint,
      back: (ptr) => mod(H.readBigint(ptr), B.p),
    });
    equiv(
      { from: [raw], to: raw, scratch: 3 },
      (a) => mod(B.inverse(a) * F.R * F.R, B.p),
      ([scratch], out, a) => W.inverse(scratch, out, a),
      "inverse"
    );
    equiv(
      { from: [raw], to: raw, scratch: 3 },
      (a) => mod(B.inverse(a) * F.R * F.R, B.p),
      ([scratch], out, a) => {
        W.inverse(scratch, a, a);
        H.writeBigint(out, H.readBigint(a));
      },
      "inverse in place"
    );
    // the reference that the fast inverse replaced
    if (label !== "composite15") {
      equiv(
        { from: [raw], to: raw, scratch: 3 },
        (a) => mod(B.inverse(a) * F.R * F.R, B.p),
        ([scratch], out, a) => W.inverseKaliski(scratch, out, a),
        "Kaliski reference"
      );
    }
    // Boundary input that needs a negative remainder correction.
    if (label === "pastaFp") {
      const [a, out] = H.local.getPointers(2);
      const scratch = H.local.getPointer(3 * F.size);
      H.writeBigint(a, B.p - 1n);
      W.inverse(scratch, out, a);
      assert.equal(
        mod(H.readBigint(out), B.p),
        mod(B.inverse(B.p - 1n) * F.R * F.R, B.p)
      );
    }
    const nearlyEqual = wasmSpec(
      H,
      Random.map(
        Random.tuple([Random.int(2, 7), Random.int(-25, 25)]),
        ([divisor, offset]) => mod(B.p / BigInt(divisor) + BigInt(offset), B.p)
      ),
      {
        size: F.size,
        there: H.writeBigint,
        back: (ptr) => mod(H.readBigint(ptr), B.p),
      }
    );
    equiv(
      { from: [nearlyEqual], to: raw, scratch: 3 },
      (a) => mod(B.inverse(a) * F.R * F.R, B.p),
      ([scratch], out, a) => W.inverse(scratch, out, a),
      "nearly equal remainders"
    );
  });
}
