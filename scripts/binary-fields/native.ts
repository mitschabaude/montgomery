/**
 * Builds ./native.c, checks its kernels against the reference and prints its timings.
 *
 * node scripts/binary-fields/native.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { mulPoly, randomElement } from "./reference.ts";

const binary = "build/binary-fields/native";
fs.mkdirSync("build/binary-fields", { recursive: true });
execFileSync("gcc", [
  "-O3",
  "-march=native",
  "scripts/binary-fields/native.c",
  "-o",
  binary,
]);

const hex = (v: bigint) => v.toString(16).padStart(32, "0");
const words = (v: bigint) => `${hex(v).slice(0, 16)} ${hex(v).slice(16)}`;
const pairs = Array.from({ length: 1000 }, () => [
  randomElement(),
  randomElement(),
]);
const input = pairs.map(([a, b]) => `${words(a)} ${words(b)}`).join("\n");
const lines = execFileSync(binary, ["check"], { input })
  .toString()
  .trim()
  .split("\n");
lines.forEach((line, i) => {
  let expected = hex(mulPoly(pairs[i][0], pairs[i][1]));
  if (line !== `${expected} ${expected}`)
    throw Error(`native: wrong product for pair ${i}`);
});

console.log("native, polynomial basis");
execFileSync(binary, { stdio: "inherit" });
