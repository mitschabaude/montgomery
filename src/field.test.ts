import { createEquivalentWasm, WasmSpec } from "./testing/equivalent-wasm.js";
import { BigintField } from "./bigint/field.js";
import { createMsmField } from "./field-msm.js";
import { exampleFields } from "./bigint/field-examples.js";
import { Random, sample, sampleOne } from "./testing/random.js";
import { Spec, throwError } from "./testing/equivalent.js";

Error.stackTraceLimit = 1000;

for (let label in exampleFields) {
  let BigintField = exampleFields[label as keyof typeof exampleFields];
  if (BigintField.sizeInBits < 33) continue; // parts of our code assume at least 2 limbs
  await testField(label, BigintField);
}

async function testField(label: string, BigintField: BigintField) {
  const w = sampleOne(Random.int(26, 31));
  const Field = await createMsmField({ p: BigintField.modulus, w, beta: 1n });
  const equiv = createEquivalentWasm(Field, { verbose: true });

  const field = WasmSpec.fieldUnreduced(Field);
  const fieldReduced = WasmSpec.field(Field);
  const fieldUntransformed = WasmSpec.fieldUnreduced(Field, {
    montgomeryTransform: false,
  });
  const fieldUntransformedReduced = WasmSpec.field(Field, {
    montgomeryTransform: false,
  });

  const boolean = WasmSpec.boolean;

  // console.log(sample(field.rng, 100).map((x) => x.toString(16)));

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
    BigintField.sub,
    Field.subtract,
    `${label} subtract`
  );

  // TODO fails in rare cases on bls12-377
  if (label !== "bls12_377_base") {
    equiv(
      {
        from: [fieldUntransformed, fieldUntransformed],
        to: fieldUntransformed,
      },
      (x, y) => x - y + 2n * Field.p,
      Field.subtractPositive,
      `${label} subtractPositive`
    );
  }

  // mul, square, shift
  equiv(
    { from: [field, field], to: field },
    BigintField.mul,
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
    (x, k) => BigintField.mul(x << BigInt(k), BigintField.inv(Field.R)),
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
  // fails
  equiv(
    { from: [fieldUntransformed], to: boolean },
    (x) => x === 0n,
    Field.isZero,
    `${label} isZero`
  );

  // inverse
  // TODO fails in rare cases on bls12-377
  if (label !== "bls12_377_base") {
    equiv(
      { from: [field], to: field, scratch: 3 },
      BigintField.inv,
      ([scratch], out, x) => Field.inverse(scratch, out, x),
      `${label} inverse`
    );
  }

  // exp
  // TODO fails in rare cases on bls12-377
  if (label !== "bls12_377_base") {
    equiv(
      { from: [field, fieldUntransformed], to: field, scratch: 1 },
      (x, k) => BigintField.exp(x, k),
      ([scratch], out, x, k) => Field.exp(scratch, out, x, k),
      `${label} exp`
    );
  }

  // sqrt
  // TODO fails in rare cases on bls12-377
  if (label !== "bls12_377_base") {
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
  }
}
