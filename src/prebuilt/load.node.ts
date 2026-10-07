import { readFile } from "node:fs/promises";

export { loadBytes };

/** bytes of a prebuilt module, next to this file */
async function loadBytes(file: string) {
  return new Uint8Array(
    await readFile(new URL(`./wasm/${file}`, import.meta.url))
  );
}
