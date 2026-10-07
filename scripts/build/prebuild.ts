/**
 * Writes the Wasm modules of prebuilt curves, see src/prebuilt.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fieldModule, glvScalarModule } from "../../src/generate.ts";
import { prebuiltCurves } from "../../src/prebuilt/curves.ts";
import type { FieldBackendName } from "../../src/field-layout.ts";

const dir = new URL("../../src/prebuilt/wasm/", import.meta.url);
mkdirSync(dir, { recursive: true });

for (let [curve, params] of Object.entries(prebuiltCurves)) {
  let { modulus: p, order: q, endomorphism } = params;
  let { beta, lambda } = endomorphism!;
  for (let backend of ["29-bit", "wide"] satisfies FieldBackendName[]) {
    let bytes = fieldModule({ p, beta, backend }).toBytes();
    writeFileSync(new URL(`${curve}.field-${backend}.wasm`, dir), bytes);
  }
  let bytes = glvScalarModule({ q, lambda, w: 29 }).toBytes();
  writeFileSync(new URL(`${curve}.scalar.wasm`, dir), bytes);
}
console.log("prebuilt modules: src/prebuilt/wasm/");
