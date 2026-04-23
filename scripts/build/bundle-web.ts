/**
 * Script to build a specific entry point for the web
 */
import * as esbuild from "esbuild";
import path from "node:path";
import fs from "node:fs";

export { buildWeb as bundleWeb };

// bundle for the web; when `minify` is set, both the outer bundle and
// the inlined worker source are minified
async function buildWeb(
  entrypoint: string,
  outdir: string,
  { minify = false }: { minify?: boolean } = {},
) {
  await esbuild.build({
    entryPoints: [entrypoint],
    bundle: true,
    keepNames: !minify,
    outdir,
    format: "esm",
    platform: "browser",
    target: "es2022",
    sourcemap: true,
    minify,
    plugins: [replaceNodeWithWeb(), inlineUrl({ minify })],
    allowOverwrite: true,
  });
  // return abs path for convenience
  return path.resolve(
    outdir,
    path.basename(entrypoint.replace(/\.ts$/, ".js")),
  );
}

async function buildBlobUrl(path: string, { minify = false } = {}) {
  let { outputFiles } = await esbuild.build({
    entryPoints: [path],
    bundle: true,
    keepNames: !minify,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify,
    plugins: [replaceNodeWithWeb()],
  });
  return outputFiles[0].text;
}

// plugin to replace '.node.js' with '.web.js' imports
function replaceNodeWithWeb() {
  return {
    name: "replace-node-with-web",
    setup(build: esbuild.PluginBuild) {
      build.onResolve(
        { filter: /\.node\.(ts|js)$/ },
        ({ path: importPath, resolveDir }) => {
          // replace .node.{ts,js} with .web.{ts,js}
          importPath = importPath.replace(/\.node\.(ts|js)$/, ".web.$1");

          // expect .web.{ts,js} to be in the same directory
          return { path: path.resolve(resolveDir, importPath) };
        },
      );
    },
  };
}

// plugin to detect any `INLINE_META_URL` labels and replace urls with blob urls generated from inlined source code
function inlineUrl({ minify = false }: { minify?: boolean } = {}) {
  return {
    name: "inline-url",
    setup(build: esbuild.PluginBuild) {
      build.onLoad({ filter: /\.(js|ts)$/ }, async (args) => {
        let contents = await fs.promises.readFile(args.path, "utf8");

        // check for `INLINE_META_URL` labels
        let inlineUrlMatch = contents.match(/INLINE_META_URL: (.+);/);
        if (inlineUrlMatch === null) return undefined;

        // bundle source code which will be inlined
        let bundleSourceCode = await buildBlobUrl(args.path, { minify });

        // source code that creates a blob url
        let newUrlSourceCode = `URL.createObjectURL(new Blob([${JSON.stringify(
          bundleSourceCode,
        )}], { type: 'application/javascript' }))`;

        // replace any `import.meta.url` with `createsBlobUrl`, but only in lines with the `INLINE_META_URL` label
        let replacementValue = inlineUrlMatch[0].replace(
          /import.meta.url/g,
          newUrlSourceCode,
        );
        contents =
          contents.slice(0, inlineUrlMatch.index) +
          replacementValue +
          contents.slice(inlineUrlMatch.index! + inlineUrlMatch[0].length);
        return { contents, loader: args.path.endsWith(".ts") ? "ts" : "js" };
      });
    },
  };
}
