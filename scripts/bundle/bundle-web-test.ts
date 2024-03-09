/**
 * Script to build a specific entry point for the web
 */
import * as esbuild from "esbuild";
import path from "node:path";

// the entry point is a JS file so that we don't have to deal with TS compilation in two different ways
let entrypoint = "build/src/msm-parallel.test.js";

// bundle for the web
await esbuild.build({
  entryPoints: [entrypoint],
  bundle: true,
  outdir: "build/web",
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  plugins: [replaceNodeWithWeb()],
});

// plugin to replace '.node.js' with '.web.js' imports
function replaceNodeWithWeb() {
  return {
    name: "replace-node-with-web",
    setup(build: esbuild.PluginBuild) {
      build.onResolve(
        { filter: /\.node.js$/ },
        ({ path: importPath, resolveDir }) => {
          // replace .node.js with .web.js
          importPath = importPath.replace(/\.node\.js$/, ".web.js");

          // expect .web.js to be in the same directory
          return { path: path.resolve(resolveDir, importPath) };
        }
      );
    },
  };
}
