import fs from "node:fs/promises";
import { createFiniteFieldWat } from "./finite-field-generate.js";
import { toBase64 } from "fast-base64";
import Wabt from "wabt";

export { compileFiniteFieldWasm, compileWat, interpretWat };

let p =
  0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;

let isMain = process.argv[1] === import.meta.url.slice(7);
if (isMain) {
  let w = 28;
  compileFiniteFieldWasm(p, w);
}

async function compileFiniteFieldWasm(p, w, { withBenchmarks = false } = {}) {
  let writer = await createFiniteFieldWat(p, w, { withBenchmarks });
  let js = await compileWat(writer);
  await fs.writeFile(`./src/finite-field.${w}.gen.wat`, writer.text);
  await fs.writeFile(`./src/finite-field.${w}.gen.wat.js`, js);
}

// --- general wat2wasm functionality ---
let wabt;

async function compileWat({ text, exports }) {
  // TODO: imports
  let wat = text;
  wabt ??= await Wabt();
  let wabtModule = wabt.parseWat("", wat, wasmFeatures);
  let wasmBytes = new Uint8Array(
    wabtModule.toBinary({ write_debug_names: true }).buffer
  );
  let base64 = await toBase64(wasmBytes);
  return `// compiled from wat
import { toBytes } from 'fast-base64';
let wasmBytes = await toBytes("${base64}");
let { instance } = await WebAssembly.instantiate(wasmBytes, {});
let { ${[...exports].join(", ")} } = instance.exports;
export { ${[...exports].join(", ")} };
`;
}

async function interpretWat({ text }) {
  // TODO: imports
  let wat = text;
  wabt ??= await Wabt();
  let wabtModule = wabt.parseWat("", wat, wasmFeatures);
  let wasmBytes = new Uint8Array(
    wabtModule.toBinary({ write_debug_names: true }).buffer
  );
  let { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return instance.exports;
}

const wasmFeatures = {
  exceptions: true,
  mutable_globals: true,
  sat_float_to_int: true,
  sign_extension: true,
  simd: true,
  threads: true,
  multi_value: true,
  tail_call: true,
  bulk_memory: true,
  reference_types: true,
  annotations: true,
  gc: true,
};