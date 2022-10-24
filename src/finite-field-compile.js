import fs from "node:fs/promises";
import { createFiniteFieldWat, createGLVWat } from "./finite-field-generate.js";
import { toBase64 } from "fast-base64";
import Wabt from "wabt";

export { compileFiniteFieldWasm, compileWat, interpretWat };

let isMain = process.argv[1] === import.meta.url.slice(7);
if (isMain) {
  let p =
    0x1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaabn;
  let w = 30;
  compileFiniteFieldWasm(p, w, { withBenchmarks: true });
  let q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
  let lambda = 0xd201000000010000n ** 2n - 1n;
  compileGLVWasm(q, lambda, w, { withBenchmarks: true });
}

async function compileFiniteFieldWasm(p, w, { withBenchmarks = false } = {}) {
  let writer = await createFiniteFieldWat(p, w, { withBenchmarks });
  let { js, wasm } = await compileWat(writer);
  await writeFile(`./src/finite-field.${w}.gen.wat`, writer.text);
  await writeFile(`./src/finite-field.${w}.gen.wat.js`, js);
  await writeFile(`./src/finite-field.wat.js`, js);
  await fs.writeFile("./src/finite-field.wasm", wasm);
}

async function compileGLVWasm(q, lambda, w, { withBenchmarks = false } = {}) {
  let writer = await createGLVWat(q, lambda, w, { withBenchmarks });
  let { js, wasm } = await compileWat(writer);
  await writeFile(`./src/scalar-glv.${w}.gen.wat`, writer.text);
  await writeFile(`./src/scalar-glv.${w}.gen.wat.js`, js);
  await writeFile(`./src/scalar-glv.wat.js`, js);
  await fs.writeFile("./src/scalar-glv.wasm", wasm);
}

// --- general wat2wasm functionality ---
let wabt;

async function writeFile(fileName, text) {
  await fs.writeFile(fileName, text, "utf8");
  console.log(`wrote ${(text.length / 1e3).toFixed(1)}kB to ${fileName}`);
}

async function compileWat({ text, exports }) {
  // TODO: imports
  let wat = text;
  wabt ??= await Wabt();
  let wabtModule = wabt.parseWat("", wat, wasmFeatures);
  let wasmBytes = new Uint8Array(
    wabtModule.toBinary({ write_debug_names: true }).buffer
  );
  let base64 = await toBase64(wasmBytes);
  return {
    wasm: wasmBytes,
    js: `// compiled from wat
import { toBytes } from 'fast-base64';
let wasmBytes = await toBytes("${base64}");
let { instance } = await WebAssembly.instantiate(wasmBytes, {});
let { ${[...exports].join(", ")} } = instance.exports;
export { ${[...exports].join(", ")} };
`,
  };
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
