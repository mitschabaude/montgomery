export { loadBytes };

/** bytes of a prebuilt module, next to this file */
async function loadBytes(file: string) {
  let response = await fetch(new URL(`./wasm/${file}`, import.meta.url));
  return new Uint8Array(await response.arrayBuffer());
}
