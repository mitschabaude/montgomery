import { cpus } from "node:os";
import { benchmark } from "./field-benchmark.ts";
import { pallasParams } from "../../src/concrete/pasta.params.ts";
import { curveParams as bls12_377 } from "../../src/concrete/bls12-377.params.ts";
import { curveParams as bls12_381 } from "../../src/concrete/bls12-381.params.ts";

console.log(
  `${process.version}, V8 ${process.versions.v8}, ${cpus()[0].model}`
);
console.log("Warmup + median of three samples, ~10M operations per sample.");

for (const params of [pallasParams, bls12_377, bls12_381]) {
  const p = params.modulus;
  let t = p - 1n;
  while (t % 2n === 0n) t >>= 1n;
  console.log(`\n${params.label}\n`);
  await benchmark({ p, t }, { onlyQuick: true, wide: true });
}
