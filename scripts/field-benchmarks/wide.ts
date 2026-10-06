import { cpus } from "node:os";
import { benchmark } from "./field-benchmark.ts";
import { bn254Params } from "../../src/concrete/bn254.params.ts";
import { pallasParams } from "../../src/concrete/pasta.params.ts";
import { curveParams as bls12_377 } from "../../src/concrete/bls12-377.params.ts";

console.log(
  `${process.version}, V8 ${process.versions.v8}, ${cpus()[0].model}`
);
console.log("Warmup + median of three samples, ~10M operations per sample.");

const fields = [
  pallasParams,
  bls12_377,
  { label: "bn254-scalar", modulus: bn254Params.order },
];
const labels = process.argv.slice(2);
for (const label of labels) {
  if (!fields.some((field) => field.label === label))
    throw Error(`Unknown field: ${label}`);
}
for (const params of fields) {
  if (labels.length > 0 && !labels.includes(params.label)) continue;
  const p = params.modulus;
  let t = p - 1n;
  while (t % 2n === 0n) t >>= 1n;
  console.log(`\n${params.label}\n`);
  await benchmark({ p, t }, { onlyQuick: true, wide: true });
}
