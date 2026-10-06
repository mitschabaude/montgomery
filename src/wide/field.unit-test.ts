import { test } from "node:test";
import assert from "node:assert/strict";
import { Field } from "./field.ts";
import { exampleFields } from "../concrete/example-fields.ts";
import { inverse } from "../bigint/field.ts";
import { mod } from "../bigint/field-util.ts";
import { createEquivalentWasm, wasmSpec } from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";

const R128 = 1n << 128n;
const cases: [string, bigint][] = [
  ...Object.entries(exampleFields).map(([label, { p }]): [string, bigint] => [
    label,
    p,
  ]),
  ["below R/4", R128 / 4n - 1n],
  ["above R/4", R128 / 4n + 1n],
  ["below R/3", R128 / 3n - 2n],
  ["above R/3", R128 / 3n + 2n],
  ["below R/2", R128 / 2n - 1n],
  ["above R/2", R128 / 2n + 1n],
];

for (const [label, p] of cases) {
  test(`wide arithmetic: ${label}`, async () => {
    const F = await Field.create(p);
    const [x, y, z] = F.Memory.local.getPointers(3);
    const Rinv = inverse(F.R, p);
    const boundary = [0n, 1n, p - 1n, p, p + 1n, F.limit - 1n];
    for (let i = 64; i < F.n * 64; i += 64) {
      boundary.push((1n << BigInt(i)) - 1n, 1n << BigInt(i));
    }
    const values = [...new Set(boundary)].filter((x) => x < F.limit);
    const pairs = values.flatMap((a) => values.map((b) => [a, b]));
    const equiv = createEquivalentWasm(F.Memory);
    const raw = wasmSpec(F.Memory, Random.uniformField(F.limit), {
      size: F.size,
      there: F.writeBigint,
      back(ptr) {
        const value = F.readBigint(ptr);
        assert(value < F.limit, "output stays within the lazy bound");
        return mod(value, p);
      },
    });
    for (const [label, op, reference] of [
      ["add", F.Wasm.add, (a: bigint, b: bigint) => mod(a + b, p)],
      ["subtract", F.Wasm.subtract, (a: bigint, b: bigint) => mod(a - b, p)],
      [
        "multiply",
        F.Wasm.multiply,
        (a: bigint, b: bigint) => mod(a * b * Rinv, p),
      ],
    ] as const) {
      equiv({ from: [raw, raw], to: raw }, reference, op, label);
      for (const alias of [0, 1]) {
        equiv(
          { from: [raw, raw], to: raw },
          reference,
          (out, a, b) => {
            const target = alias === 0 ? a : b;
            op(target, a, b);
            F.Wasm.copy(out, target);
          },
          `${label} aliases input ${alias}`
        );
      }
    }
    equiv(
      { from: [raw], to: raw },
      (a) => mod(a * a * Rinv, p),
      F.Wasm.square,
      "square"
    );
    equiv(
      { from: [raw], to: raw },
      (a) => mod(a * a * Rinv, p),
      (out, a) => {
        F.Wasm.square(a, a);
        F.Wasm.copy(out, a);
      },
      "square in place"
    );
    equiv(
      { from: [raw], to: raw, scratch: 3 },
      (a) => mod(inverse(a, p) * F.R * F.R, p),
      ([scratch], out, a) => F.Wasm.inverse(scratch, out, a),
      "fast inverse at carry thresholds"
    );
    function check(ptr: number, expected: bigint) {
      const raw = F.readBigint(ptr);
      assert(raw >= 0n && raw < F.limit, `output bound: ${raw}`);
      assert.equal(mod(raw, p), mod(expected, p));
    }
    for (const [a, b] of pairs) {
      for (const out of [z, x, y]) {
        for (const [op, expected] of [
          [F.Wasm.add, a + b],
          [F.Wasm.subtract, a - b],
          [F.Wasm.multiply, a * b * Rinv],
        ] as const) {
          F.writeBigint(x, a);
          F.writeBigint(y, b);
          op(out, x, y);
          check(out, expected);
        }
      }
      for (const out of [z, x]) {
        F.writeBigint(x, a);
        F.Wasm.square(out, x);
        check(out, a * a * Rinv);
      }
    }
    for (const a of [p - 1n, p, p + 1n, (2n * p < F.R ? 2n * p : F.R) - 1n]) {
      F.writeBigint(x, a);
      F.Wasm.reduce(x);
      assert.equal(F.readBigint(x), a % p);
    }
    for (const a of [-p - 1n, -1n, 0n, 1n, p - 1n, p, p + 1n]) {
      F.fromBigint(x, a);
      assert.equal(F.toBigint(x), mod(a, p));
      F.fromMontgomery(x);
      assert.equal(F.readBigint(x), mod(a, p));
      F.toMontgomery(x);
      assert.equal(F.toBigint(x), mod(a, p));
    }
    F.fromBigint(x, 17n);
    let expected = mod(17n, p);
    for (let i = 0; i < 1000; i++) {
      F.Wasm.square(x, x);
      expected = mod(expected * expected, p);
      assert.equal(F.toBigint(x), expected);
      assert(F.readBigint(x) < F.limit);
    }
    F.Wasm.copy(y, x);
    assert.equal(F.Wasm.isEqual(x, y), 1);
    F.writeBigint(z, 0n);
    assert.equal(F.Wasm.isZero(z), 1);
    F.writeBigint(z, 1n);
    assert.equal(F.Wasm.isZero(z), 0);
  });
}
