/**
 * Publish-time web bundle: a minified, self-contained browser build of the
 * public entry point, with the worker source inlined as a blob URL.
 */
import { bundleWeb } from "./bundle-web.ts";
import { mkdirSync } from "node:fs";

mkdirSync("build/web", { recursive: true });
await bundleWeb("src/index.ts", "build/web", { minify: true });
console.log("built for the browser: build/web/index.js");
