/**
 * Runs a script in the SpiderMonkey shell, Firefox's JS engine without the browser.
 *
 * node scripts/bench/shell.ts [--firefox <version>|nightly] <entry.ts> [...args]
 *
 * Downloads the shell for the given Firefox release (default: latest) into
 * ~/.cache/montgomery/, bundles the entry with esbuild and runs it.
 */
import * as esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { replaceNodeWithWeb } from "../build/bundle-web.ts";
import { getJsShell } from "./mozilla.ts";

const assertStub = `
function assert(condition, message) {
  if (!condition) throw Error(message ?? "assertion failed");
}
assert.ok = assert;
assert.equal = (a, b, message) => assert(a === b, message ?? \`\${a} !== \${b}\`);
assert.deepEqual = (a, b, message) =>
  assert(String(a) === String(b), message ?? \`\${a} !== \${b}\`);
export default assert;
`;

let args = process.argv.slice(2);
let firefox = "latest";
if (args[0] === "--firefox") [, firefox, ...args] = args;
let [entry, ...scriptArgs] = args;
if (entry === undefined)
  throw Error("usage: shell.ts [--firefox <version>] <entry.ts> [...args]");

let js = await getJsShell(firefox);
let version = execFileSync(js, ["--version"], { encoding: "utf8" }).trim();
let cpu = os.cpus()[0].model;

let outfile = path.resolve(
  "build/shell",
  path.basename(entry).replace(/\.ts$/, ".js"),
);
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  inject: [path.resolve(import.meta.dirname, "shims.ts")],
  define: { __SHELL_VERSION__: JSON.stringify(version) },
  plugins: [replaceNodeWithWeb(), stubNodeModules(cpu)],
  logLevel: "warning",
});
execFileSync(js, ["-m", outfile, "--", ...scriptArgs], { stdio: "inherit" });

// node builtins and wabt are only imported for things the benchmarks don't do
// in the shell, like writing .wat files; except `node:os` for the CPU model and
// `node:assert` for sanity checks
function stubNodeModules(cpu: string): esbuild.Plugin {
  let stubs: Record<string, string> = {
    "node:os": `export function cpus() { return [{ model: ${JSON.stringify(
      cpu,
    )} }]; }`,
    "node:assert": assertStub,
    "node:assert/strict": assertStub,
  };
  return {
    name: "stub-node-modules",
    setup(build) {
      build.onResolve({ filter: /^(node:|wabt$)/ }, ({ path }) => ({
        path,
        namespace: "stub",
      }));
      build.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
        contents: stubs[path] ?? "export default () => ({});",
      }));
    },
  };
}
