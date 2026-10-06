import { test } from "node:test";
import assert from "node:assert/strict";
import { Field } from "./field.ts";
import { exampleFields } from "../concrete/example-fields.ts";
import {
  createEquivalentWasm,
  wasmSpec,
  WasmSpec,
} from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";
import { Spec } from "../testing/equivalent.ts";
import { mod } from "../bigint/field-util.ts";

for (const [label, BigintField] of Object.entries(exampleFields)) {
  test(`wide curve operations: ${label}`, async () => {
    const F = await Field.create(BigintField.p);
    const W = F.Wasm;
    const equiv = createEquivalentWasm(F.Memory);
    const field = wasmSpec(F.Memory, Random.field(F.p), {
      size: F.size,
      there: F.fromBigint,
      back: F.toBigint,
    });
    const raw = wasmSpec(F.Memory, Random.uniformField(F.R), {
      size: F.size,
      there: F.writeBigint,
      back: F.readBigint,
    });
    equiv({ from: [field], to: field }, BigintField.negate, W.negate, "negate");
    const lazy = wasmSpec(F.Memory, Random.uniformField(F.limit), {
      size: F.size,
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
    equiv(
      { from: [raw, raw], to: raw },
      (x, y) => mod(x + y, F.R),
      W.addNoReduce,
      "raw add"
    );
    equiv(
      { from: [raw, raw], to: raw },
      (x, y) => mod(x - y, F.R),
      W.subtractNoReduce,
      "raw subtract"
    );
    equiv(
      { from: [raw, raw], to: WasmSpec.boolean },
      (x, y) => x > y,
      W.isGreater,
      "isGreater"
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
    equiv(
      { from: [field, raw], to: field, scratch: 1 },
      BigintField.exp,
      ([scratch], out, x, k) => W.exp(scratch, out, x, k),
      "exp"
    );
    equiv(
      { from: [field, raw], to: field, scratch: 1 },
      BigintField.exp,
      ([scratch], out, x, k) => {
        W.exp(scratch, x, x, k);
        W.copy(out, x);
      },
      "exp in place"
    );
    equiv(
      { from: [field, raw], to: field, scratch: 1 },
      BigintField.exp,
      ([scratch], out, x, k) => {
        W.exp(scratch, k, x, k);
        W.copy(out, k);
      },
      "exp aliases exponent"
    );
    equiv(
      { from: [field, Spec.numberLessThan(F.p.toString(2).length)], to: field },
      (x, k) => BigintField.multiply(x << BigInt(k), BigintField.inverse(F.R)),
      W.leftShift,
      "leftShift"
    );
    const packedInput = wasmSpec(F.Memory, Random.field(F.p), {
      size: F.size,
      there: F.writeBigint,
      back: F.readBigint,
    });
    const bytes = F.Memory.local.getPointer(F.packedSizeField);
    const packedBytes = wasmSpec(F.Memory, Random.bytes(F.packedSizeField), {
      size: F.packedSizeField,
      there(ptr, bytes) {
        new Uint8Array(W.memory.buffer, ptr, bytes.length).set(bytes);
      },
      back(ptr) {
        return [...new Uint8Array(W.memory.buffer, ptr, F.packedSizeField)];
      },
    });
    equiv(
      { from: [packedInput], to: packedBytes },
      (a) =>
        Array.from({ length: F.packedSizeField }, (_, i) =>
          Number((a >> BigInt(8 * i)) & 255n)
        ),
      W.toPackedBytes,
      "packed bytes are little endian"
    );
    equiv(
      { from: [packedBytes], to: raw },
      (bytes) =>
        bytes.reduce((a, byte, i) => a | (BigInt(byte) << BigInt(8 * i)), 0n),
      W.fromPackedBytes,
      "unpack bytes"
    );
    equiv(
      { from: [packedInput], to: packedInput },
      (x) => x,
      (out, x) => {
        W.toPackedBytes(bytes, x);
        W.fromPackedBytes(out, bytes);
      },
      "packed bytes roundtrip"
    );
    equiv(
      { from: [packedInput], to: packedInput },
      (x) => x,
      (out, x) => {
        W.toPackedBytes(x, x);
        W.fromPackedBytes(x, x);
        W.copy(out, x);
      },
      "packed bytes in place"
    );

    let count = 0;
    const array = wasmSpec(
      F.Memory,
      Random.array(
        Random.reject(Random.field(F.p), (x) => x === 0n),
        Random.nat(20)
      ),
      {
        size: 20 * F.size,
        there(ptr, xs) {
          count = xs.length;
          xs.forEach((x, i) => F.fromBigint(ptr + i * F.size, x));
        },
        back(ptr) {
          return Array.from({ length: count }, (_, i) =>
            F.toBigint(ptr + i * F.size)
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
    const [scratch] = F.Memory.local.getPointers(1, 4 * F.size);
    const [zero, out] = F.Memory.local.getPointers(2);
    // Exercise whole-limb shifts in makeOdd, including a shift that ends odd.
    for (let bit = 64; bit < 64 * F.n; bit += 64) {
      const a = 1n << BigInt(bit);
      if (a >= F.limit) continue;
      F.writeBigint(zero, a);
      W.inverse(scratch, out, zero);
      assert.equal(F.toBigint(out), BigintField.inverse(F.toBigint(zero)));
    }
    F.writeBigint(zero, 0n);
    W.exp(scratch, out, zero, zero);
    assert.equal(F.toBigint(out), 1n);

    assert.throws(
      () => W.inverse(scratch, out, zero),
      WebAssembly.RuntimeError
    );
    W.batchInverse(scratch, out, zero, 0);
    assert.throws(
      () => W.batchInverse(scratch, out, zero, 1),
      WebAssembly.RuntimeError
    );
    assert.throws(
      () => W.leftShift(out, zero, F.p.toString(2).length),
      WebAssembly.RuntimeError
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
