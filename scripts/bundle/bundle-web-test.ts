/**
 * Script to build a specific entry point for the web
 */
import { buildWeb } from "./bundle-web.js";

// the entry point is a JS file so that we don't have to deal with TS compilation in two different ways
let entrypoint = "build/src/msm-parallel.test.js";

let path = await buildWeb(entrypoint, "build/web");
console.log("created", path);
