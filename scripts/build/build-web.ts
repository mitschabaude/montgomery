#!/usr/bin/env node
import path from "node:path";
import { bundleWeb } from "./bundle-web.js";

// get first and only command line argument
let filename = process.argv[2];

// transform ts file name in the source tree to js file in /build
const src = filename.replace(/\.ts$/, ".js");
const entrypoint = path.resolve("build/", src);

let targetDir = path.dirname(path.join("build/web/", src));
let absPath = await bundleWeb(entrypoint, targetDir);
let filePath = path.join(targetDir, path.basename(absPath));

console.log(`built ${filePath} for the web.`);
