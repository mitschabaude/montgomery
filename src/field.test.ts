import { createEquivalentWasm, WasmSpec } from "./testing/equivalent-wasm.js";
import { BigintField } from "./bigint/field.js";
import { createMsmField, MsmField } from "./field-msm.js";
import { exampleFields } from "./concrete/example-fields.js";
import { Spec, throwError } from "./testing/equivalent.js";
import { test } from "node:test";
import { Random, sample, sampleOne } from "./testing/random.js";
import { batchInverse } from "./curve-affine.js";

Error.stackTraceLimit = 1000;

// TODO a few cases always fail:
// - pastaFq, w=26 and w=29 (only fast sqrt fails)

for (let label in exampleFields) {
  let BigintField = exampleFields[label as keyof typeof exampleFields];
  if (BigintField.sizeInBits < 33) continue; // parts of our code assume at least 2 limbs

  for (let w of [26, 27, 28, 29, 30, 31]) {
    let l = `${label} w=${w}`;
    await test(l, async () => {
      await testField(l, w, BigintField);
    });
  }
}

async function testField(label: string, w: number, BigintField: BigintField) {
  const Field = await createMsmField({ p: BigintField.modulus, w, beta: 1n });
  const equiv = createEquivalentWasm(Field);

  const field = WasmSpec.fieldUnreduced(Field);
  const fieldReduced = WasmSpec.field(Field);
  const fieldUntransformed = WasmSpec.fieldUnreduced(Field, {
    montgomeryTransform: false,
  });
  const fieldUntransformedReduced = WasmSpec.field(Field, {
    montgomeryTransform: false,
  });

  const boolean = WasmSpec.boolean;

  // reduce
  equiv(
    { from: [fieldUntransformed], to: fieldUntransformed },
    BigintField.mod,
    (out, x) => {
      Field.copy(out, x);
      Field.reduce(out);
    },
    `${label} reduce`
  );

  // add, subtract
  // TODO bigint impl which handles unreduced inputs
  equiv(
    { from: [fieldReduced, fieldReduced], to: field },
    BigintField.add,
    Field.add,
    `${label} add`
  );
  equiv(
    { from: [fieldReduced, fieldReduced], to: field },
    BigintField.subtract,
    Field.subtract,
    `${label} subtract`
  );

  equiv(
    {
      from: [fieldUntransformedReduced, fieldUntransformedReduced],
      to: fieldUntransformedReduced,
    },
    (x, y) => x - y + 2n * Field.p,
    Field.subtractPositive,
    `${label} subtractPositive`
  );

  // mul, square, shift
  equiv(
    { from: [field, field], to: field },
    BigintField.multiply,
    Field.multiply,
    `${label} multiply`
  );
  equiv(
    { from: [field], to: field },
    BigintField.square,
    Field.square,
    `${label} square`
  );
  equiv(
    {
      from: [fieldReduced, Spec.numberLessThan(Field.bitLength)],
      to: field,
    },
    // 2^k is not in montgomery form, so this ends up with a R^-1 factor
    (x, k) =>
      BigintField.multiply(x << BigInt(k), BigintField.inverse(Field.R)),
    Field.leftShift,
    `${label} left shift`
  );

  // is equal, is zero
  equiv(
    { from: [fieldUntransformed, fieldUntransformed], to: boolean },
    (x, y) => x === y,
    Field.isEqual,
    `${label} isEqual`
  );
  equiv(
    { from: [fieldUntransformed], to: boolean },
    (x) => x === 0n,
    Field.isZero,
    `${label} isZero`
  );

  // inverse
  equiv(
    { from: [field], to: field, scratch: 3 },
    BigintField.inverse,
    ([scratch], out, x) => Field.inverse(scratch, out, x),
    `${label} inverse`
  );

  // exp
  equiv(
    { from: [field, fieldUntransformed], to: field, scratch: 1 },
    (x, k) => BigintField.exp(x, k),
    ([scratch], out, x, k) => Field.exp(scratch, out, x, k),
    `${label} exp`
  );

  // sqrt
  equiv(
    { from: [fieldReduced], to: fieldReduced, scratch: 10 },
    (x) => {
      let exists =
        x === 0n || BigintField.exp(x, (BigintField.p - 1n) >> 1n) === 1n;
      if (!exists) throwError("no sqrt (bigint)");
      return x;
    },
    (scratch, out, x) => {
      Field.reduce(x);
      let exists = Field.sqrt(scratch, out, x);
      if (!exists) throwError("no sqrt (wasm)");
      Field.square(out, out);
    },
    `${label} sqrt`
  );

  // batch inverse
  for (let n of sample(Random.nat(100), 20)) {
    testBatchMontgomery(n, BigintField, Field);
  }
}

// TODO represent this test more elegantly as as equivalence test
// by defining how to map arrays to/from wasm
function testBatchMontgomery(
  n: number,
  BigintField: BigintField,
  Field: MsmField
) {
  let field = Random.reject(Random.field(Field.p), (x) => x === 0n);
  let X = Field.local.getPointers(n);
  let invX = Field.local.getPointers(n);
  let scratch = Field.local.getPointers(10);

  for (let i = 0; i < n; i++) {
    let x0 = sampleOne(field);
    Field.writeBigint(X[i], x0);
    // compute inverses normally
    Field.inverse(scratch[0], invX[i], X[i]);
  }
  // compute inverses as batch
  let invX1 = Field.getPointers(n);
  Field.batchInverse(scratch[0], invX1[0], X[0], n);
  let invX2 = batchInverse(Field, X);

  // check that all inverses are equal
  for (let i = 0; i < n; i++) {
    let z0 = Field.readBigint(invX[i]);
    let z1 = Field.readBigint(invX1[i]);
    let z2 = Field.readBigint(invX2[i]);
    if (!BigintField.isEqual(z1, z0)) throw Error("batch inverse");
    if (!BigintField.isEqual(z2, z0)) throw Error("batch inverse JS");

    Field.reduce(invX1[i]);
    Field.reduce(invX2[i]);
    Field.reduce(invX[i]);
    if (!Field.isEqual(invX1[i], invX[i])) {
      console.log({
        i,
        z0,
        z1,
        invX0: Field.readBigint(invX[i]),
        invX1: Field.readBigint(invX1[i]),
      });
      throw Error("batch inverse / reduce");
    }
    if (!Field.isEqual(invX2[i], invX[i])) {
      console.log({
        i,
        z0,
        z1,
        invX0: Field.readBigint(invX[i]),
        invX1: Field.readBigint(invX2[i]),
      });
      throw Error("batch inverse / reduce JS");
    }
  }
}
