import {
  PointVectorInput,
  ScalarVectorInput,
  compute_msm,
} from "./src/reference.node.js";
import { msm } from "./src/curve.js";
import { tic, toc } from "./src/tictoc.js";
import { load } from "./src/store-inputs.js";
import { cpus } from "node:os";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

// node crypto
globalThis.crypto = (await import("crypto")).webcrypto;

let n = process.argv[2] ?? 14;
console.log(`running msm with 2^${n} inputs`);

tic("load inputs & convert to rust");
let { points, scalars } = await load(n);
// TODO: loading into Rust memory fails for n >= 15
let scalarVec = ScalarVectorInput.fromJsArray(scalars);
let pointVec = PointVectorInput.fromJsArray(points);
toc();

tic("msm (rust)");
compute_msm(pointVec, scalarVec);
let ref = toc();

tic("msm (ours)");
msm(scalars, points);
let ours = toc();

let commit = execSync("git rev-parse --short HEAD").toString().trim();
let cpu = cpus()[0].model;

let benchmark = { n, ref, ours, commit, cpu };

let file = "./bench.json";
/**
 * @type {(typeof benchmark)[]}
 */
let benchmarks = JSON.parse(await readFile(file, "utf-8"));

// delete any benchmark for same commit & cpu & n
let redundant = benchmarks.findIndex(
  (b) => b.commit === commit && b.cpu === cpu && b.n === n
);
if (redundant !== -1) benchmarks.splice(redundant, 1);

benchmarks.push(benchmark);
await writeFile(file, JSON.stringify(benchmarks, null, 1), "utf-8");
