/**
 * Publish-time web bundles: minified, self-contained browser builds of the
 * public entry points, with the worker source inlined as a blob URL. The
 * prebuilt curves carry their Wasm modules.
 */
import { bundleWeb } from "./bundle-web.ts";
import { mkdirSync } from "node:fs";

mkdirSync("build/web", { recursive: true });
for (let entry of [
  "src/index.ts",
  "src/prebuilt/pallas.ts",
  "src/prebuilt/bls12-377.ts",
]) {
  let output = await bundleWeb(entry, "build/web", { minify: true });
  console.log(`built for the browser: ${output}`);
}
