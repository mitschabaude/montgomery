import { test } from "node:test";
import assert from "node:assert/strict";
import { Field } from "./field.ts";
import { exampleFields } from "../concrete/example-fields.ts";
import { createEquivalentWasm, wasmSpec } from "../testing/equivalent-wasm.ts";
import { Random } from "../testing/random.ts";

for (const [label, BigintField] of Object.entries(exampleFields)) {
  test(`wide helpers: ${label}`, async () => {
    const F = await Field.create(BigintField.p);
    const W = F.Wasm;
    const equiv = createEquivalentWasm(F.Memory);
    const field = wasmSpec(F.Memory, Random.field(F.p), {
      size: F.sizeField,
      there: F.fromBigint,
      back: F.toBigint,
    });
    const raw = wasmSpec(F.Memory, Random.uniformField(F.R), {
      size: F.sizeField,
      there: F.writeBigint,
      back: F.readBigint,
    });
    equiv({ from: [field], to: field }, BigintField.negate, W.negate, "negate");
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
    const packedInput = wasmSpec(F.Memory, Random.field(F.p), {
      size: F.sizeField,
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

    const [scratch, zero, out] = F.Memory.local.getPointers(3);
    F.writeBigint(zero, 0n);
    W.exp(scratch, out, zero, zero);
    assert.equal(F.toBigint(out), 1n);
  });
}
