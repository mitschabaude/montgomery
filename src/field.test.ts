import { createEquivalentWasm, WasmSpec } from "./testing/equivalent-wasm.js";
import { BigintField } from "./bigint/field.js";
import { createMsmField } from "./field-msm.js";
import { exampleFields } from "./bigint/field-examples.js";
import { Random, sample, sampleOne } from "./testing/random.js";

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

  const fieldReduced = WasmSpec.field(Field);
  const field = WasmSpec.fieldUnreduced(Field);
  const boolean = WasmSpec.boolean;

  // console.log(sample(field.rng, 100).map((x) => x.toString(16)));

  equiv(
    { from: [field, field], to: field },
    BigintField.mul,
    Field.multiply,
    `multiply ${label}`
  );

  // equiv(
  //   { from: [field], to: boolean },
  //   (x) => BigintField.equal(x, 0n),
  //   Field.isZero,
  //   `isZero ${label}`
  // );
}
