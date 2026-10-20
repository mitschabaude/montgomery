/**
 * Runs a script in a headless browser and prints its console output.
 *
 * node scripts/bench/browser.ts firefox [--firefox <version>] <entry.ts> [...args]
 * node scripts/bench/browser.ts chromium [--wide] <entry.ts> [...args]
 *
 * Firefox is the stock release (default: latest), downloaded into ~/.cache/montgomery/
 * and driven over WebDriver BiDi. Chromium is Playwright's; `--wide` enables
 * Wasm wide arithmetic, which Chromium still has behind a flag.
 */
import { chromium, firefox, type Browser } from "playwright";
import { serveWeb } from "../build/serve-web.ts";
import { getFirefox } from "./mozilla.ts";

let [name, ...args] = process.argv.slice(2);
let version = "latest";
if (args[0] === "--firefox") [, version, ...args] = args;
let wide = args[0] === "--wide";
if (wide) args = args.slice(1);
if ((name !== "firefox" && name !== "chromium") || args.length === 0)
  throw Error(
    "usage: browser.ts firefox|chromium [options] <entry.ts> [...args]",
  );

let browser: Browser =
  name === "firefox"
    ? await firefox.launch({
        channel: "moz-firefox",
        executablePath: await getFirefox(version),
      })
    : await chromium.launch({
        args: wide ? ["--js-flags=--wasm-wide-arithmetic"] : [],
      });
console.log(`${name} ${browser.version()}`);

let { url, server } = await serveWeb(args, { port: 0 });
let page = await browser.newPage();
let failed = false;
// print console arguments like node would, in order
let printing = Promise.resolve();
page.on("console", (message) => {
  if (message.type() === "error") failed = true;
  let values = Promise.all(message.args().map((arg) => arg.jsonValue()));
  printing = printing.then(async () =>
    console.log(...(await values.catch(() => [message.text()]))),
  );
});
page.on("pageerror", (error) => {
  console.error(error.stack ?? error.message);
  failed = true;
});
await page.goto(url);
while (!failed && !(await page.evaluate(() => (globalThis as any).scriptDone)))
  await page.waitForTimeout(200);
await printing;
await browser.close();
server.close();
if (failed) process.exit(1);
