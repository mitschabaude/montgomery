/**
 * Serve a script bundled for the web, on a page that runs it
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { type AddressInfo } from "node:net";
import { bundleWeb } from "./bundle-web.ts";

export { serveWeb };

// `argv` is the entry script followed by its arguments
async function serveWeb(
  argv: string[],
  { minify = false, port = 8000 }: { minify?: boolean; port?: number } = {},
) {
  let src = argv[0];

  // esbuild handles .ts natively; bundle the source directly
  let srcjs = src.replace(/\.ts$/, ".js");
  let targetDir = path.dirname(path.join("build/web/", srcjs));
  let absPath = await bundleWeb(src, targetDir, { minify });
  let fileName = path.basename(absPath);
  let filePath = path.join(targetDir, fileName);

  const indexHtml = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <link rel="icon" href="data:," />
    <title>${fileName}</title>
    <script>
      // pass command line arguments, so browser argv has the same shape
      // as native node execution of the target script
      window.process = { argv: ${JSON.stringify([process.argv[0], ...argv])} };
    </script>
    <script type="module" src="./${fileName}">
    </script>
  </head>
  <body>
    <div>Check out the console (F12)</div>
  </body>
</html>

`;

  const defaultHeaders = {
    "content-type": "text/html",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
  };

  const server = http.createServer(async (req, res) => {
    let file = "." + req.url;
    if (file === "./") file = "./index.html";

    let content;
    if (file === "./index.html") content = indexHtml;
    else {
      try {
        content = await fs.promises.readFile(
          path.resolve(targetDir, file),
          "utf8",
        );
      } catch (err) {
        res.writeHead(404, defaultHeaders);
        res.write("<html><body>404</body><html>");
        res.end();
        return;
      }
    }

    const extension = path.basename(file).split(".").pop();
    const contentType = {
      html: "text/html",
      js: "application/javascript",
      map: "application/json",
    }[extension!];
    const headers = { ...defaultHeaders, "content-type": contentType };

    res.writeHead(200, headers);
    res.write(content);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  let url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { filePath, url, server };
}
