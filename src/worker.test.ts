/**
 * Workers run src/parallel.ts, and only instantiate modules that the main
 * thread compiled. Neither it nor what it imports loads wasmati or the code
 * generator, which keeps the worker code small, also where browser builds
 * inline it.
 */
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { assert } from "./util.ts";

let { metafile } = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("./parallel.ts", import.meta.url))],
  bundle: true,
  write: false,
  metafile: true,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
let generators = Object.keys(metafile!.inputs).filter(
  (file) => file.includes("wasmati") || file.endsWith("src/generate.ts")
);
assert(
  generators.length === 0,
  `src/parallel.ts imports ${generators.join(", ")}`
);
console.log(
  `the worker code has ${
    Object.keys(metafile!.inputs).length
  } modules, without wasmati`
);
