// Engine-neutral harness for build/wide-kernels/kernels.wasm (see ./wide-kernels.ts).
// Runs as-is in Node and in the SpiderMonkey shell.
const path = "build/wide-kernels/kernels.wasm";
const isShell =
  typeof os !== "undefined" && typeof os.file?.readFile === "function";
const bytes = isShell
  ? os.file.readFile(path, "binary")
  : (await import("node:fs")).readFileSync(path);
const log = typeof print === "function" ? print : console.log;

const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes));
const { memory, mulWide, macLoop, multiply, multiplyLoop } = instance.exports;

// correctness: (2^64 - 1)^2 = 2^128 - 2^65 + 1
const [lo, hi] = mulWide(-1n, -1n);
if (lo !== 1n || hi !== -2n) throw Error(`mulWide: ${lo}, ${hi}`);

// x = some field element < p, little-endian 64-bit limbs
new BigUint64Array(memory.buffer, 0, 4).set([
  0x1234567890abcdefn,
  0xfedcba0987654321n,
  0x0f1e2d3c4b5a6978n,
  0x0123456789abcdefn,
]);

function bench(label, f, n) {
  f(); // warm up into the optimizing tier
  let best = Infinity;
  for (let k = 0; k < 5; k++) {
    let t = performance.now();
    f();
    best = Math.min(best, performance.now() - t);
  }
  log(`${label.padEnd(30)} ${((best / n) * 1e6).toFixed(2)} ns`);
}

const N = 1e8;
bench("mul_wide_u + add128 (thrpt)", () => macLoop(3n, 5n, N), N);
const M = 1e7;
bench("pallas multiply (latency)", () => multiplyLoop(0, M), M);

// keep these alive so the engine prints their code
globalThis.keep = [mulWide, multiply];
if (typeof wasmDis === "function") {
  for (const name of ["mulWide", "add128", "macLoop", "multiply"]) {
    log(`\n--- ${name} ---`);
    wasmDis(instance.exports[name], { tier: "ion" });
  }
}
