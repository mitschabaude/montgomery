/**
 * Correctness checks and timings for the GF(2^128) kernels in ./kernels.ts.
 *
 * node --wasm-wide-arithmetic scripts/binary-fields/bench.ts
 * node scripts/bench/shell.ts scripts/binary-fields/bench.ts
 *
 * Without wide arithmetic, the `wide` kernel is skipped.
 */
import { cpus } from "node:os";
import { createModules, layout } from "./kernels.ts";
import {
  mulByGenerator,
  mulPoly,
  mulTower,
  randomElement,
} from "./reference.ts";

console.log(
  [
    process.version,
    process.versions.v8 && `V8 ${process.versions.v8}`,
    cpus()[0].model,
  ]
    .filter(Boolean)
    .join(", "),
);

const modules = createModules();
const portable = (await modules.portable.instantiate()).instance.exports;
let wide: typeof portable | undefined;
try {
  wide = (await modules.wide.instantiate()).instance.exports as any;
} catch {
  console.log("no wide arithmetic, skipping `wide`");
}

const memory = new Uint8Array(portable.memory.buffer);
for (let a = 0; a < 256; a++) {
  for (let b = 0; b < 256; b++)
    memory[layout.towerMul8 + (a << 8) + b] = Number(
      mulTower(BigInt(a), BigInt(b), 3),
    );
  memory[layout.towerMulZ3 + a] = Number(mulByGenerator(BigInt(a), 3));
}

const N = 1024;
const [x, y, z, h] = [0, 1, 2, 3].map((i) => layout.scratch + i * 16 * N);

function write(mem: WebAssembly.Memory, ptr: number, values: bigint[]) {
  let view = new DataView(mem.buffer);
  values.forEach((v, i) => {
    view.setBigUint64(ptr + 16 * i, BigInt.asUintN(64, v), true);
    view.setBigUint64(ptr + 16 * i + 8, v >> 64n, true);
  });
}
function read(mem: WebAssembly.Memory, ptr: number, n: number) {
  let view = new DataView(mem.buffer);
  return Array.from(
    { length: n },
    (_, i) =>
      view.getBigUint64(ptr + 16 * i, true) |
      (view.getBigUint64(ptr + 16 * i + 8, true) << 64n),
  );
}

function best(f: () => void) {
  f();
  let t = Infinity;
  for (let k = 0; k < 5; k++) {
    let start = performance.now();
    f();
    t = Math.min(t, performance.now() - start);
  }
  return t;
}

type Exports = Record<string, any>;
const xs = Array.from({ length: N }, randomElement);
const ys = Array.from({ length: N }, randomElement);
const hs = [randomElement()];

function check(label: string, actual: bigint[], expected: bigint[]) {
  let bad = actual.findIndex((v, i) => v !== expected[i]);
  if (bad !== -1) throw Error(`${label}: wrong product at ${bad}`);
}

function report(
  label: string,
  latencyMs: number,
  nLatency: number,
  throughputMs: number,
  nThroughput: number,
) {
  console.log(
    `${label.padEnd(8)} latency ${((latencyMs / nLatency) * 1e6)
      .toFixed(1)
      .padStart(6)} ns   throughput ${((throughputMs / nThroughput) * 1e6)
      .toFixed(1)
      .padStart(6)} ns`,
  );
}

const L = 200_000;
const R = 200;

function benchBinary(
  label: string,
  W: Exports,
  reference: (a: bigint, b: bigint) => bigint,
) {
  write(W.memory, x, xs);
  write(W.memory, y, ys);
  W[`${label}Throughput`](z, x, y, N);
  check(
    label,
    read(W.memory, z, N),
    xs.map((a, i) => reference(a, ys[i])),
  );
  let c = y;
  write(W.memory, x, xs);
  W[`${label}Latency`](x, c, 1000);
  let expected = xs[0];
  for (let i = 0; i < 1000; i++) expected = reference(expected, ys[0]);
  check(`${label} chain`, read(W.memory, x, 1), [expected]);
  let tl = best(() => W[`${label}Latency`](x, c, L));
  let tt = best(() => {
    for (let r = 0; r < R; r++) W[`${label}Throughput`](z, x, y, N);
  });
  report(label, tl, L, tt, R * N);
}

function benchTable(w: 4 | 8) {
  let label = `table${w}`;
  let W = portable as Exports;
  write(W.memory, h, hs);
  let tb = best(() => W[`${label}Build`](h));
  write(W.memory, x, xs);
  W[`${label}Throughput`](z, x, N);
  check(
    label,
    read(W.memory, z, N),
    xs.map((a) => mulPoly(a, hs[0])),
  );
  W[`${label}Latency`](x, 1000);
  let expected = xs[0];
  for (let i = 0; i < 1000; i++) expected = mulPoly(expected, hs[0]);
  check(`${label} chain`, read(W.memory, x, 1), [expected]);
  let tl = best(() => W[`${label}Latency`](x, L));
  let tt = best(() => {
    for (let r = 0; r < R; r++) W[`${label}Throughput`](z, x, N);
  });
  report(label, tl, L, tt, R * N);
  console.log(`${"".padEnd(8)} table build ${(tb * 1e3).toFixed(1)} µs`);
}

console.log("polynomial basis, mod x^128 + x^7 + x^2 + x + 1");
benchBinary("masked", portable, mulPoly);
if (wide) benchBinary("wide", wide, mulPoly);
benchTable(4);
benchTable(8);
// 128 elements as 128 bit-planes: plane j has bit e set iff element e has bit j set
function toPlanes(elements: bigint[]) {
  return Array.from({ length: 128 }, (_, j) =>
    elements.reduce(
      (plane, v, e) => plane | (((v >> BigInt(j)) & 1n) << BigInt(e)),
      0n,
    ),
  );
}
function benchBitsliced() {
  let W = portable as Exports;
  let [a, b] = [xs.slice(0, 128), ys.slice(0, 128)];
  write(W.memory, x, toPlanes(a));
  write(W.memory, y, toPlanes(b));
  W.bitsliced(z, x, y);
  check(
    "bitsliced",
    toPlanes(read(W.memory, z, 128)),
    a.map((v, i) => mulPoly(v, b[i])),
  );
  let t = best(() => {
    for (let r = 0; r < R; r++) W.bitsliced(z, x, y);
  });
  console.log(
    `${"bitsliced".padEnd(8)} throughput ${((t / (R * 128)) * 1e6)
      .toFixed(1)
      .padStart(6)} ns   (bit-planes in and out, no transposition)`,
  );
}

benchBitsliced();
console.log("tower basis");
benchBinary("tower", portable, (a, b) => mulTower(a, b));
