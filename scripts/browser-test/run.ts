/**
 * Runs ./msm.ts in headless Chromium, bundled and minified like the published
 * web build. This catches what node tests can't, like bundling that breaks
 * the inlined worker code.
 *
 * Needs a Playwright browser: `npx playwright install chromium-headless-shell`
 */
import { chromium } from "playwright";
import { serveWeb } from "../build/serve-web.ts";

const timeout = 120_000;

let { url, server } = await serveWeb(["scripts/browser-test/msm.ts"], {
  minify: true,
  port: 0,
});
let browser = await chromium.launch();
let page = await browser.newPage();

let errors: string[] = [];
page.on("console", (message) => {
  console.log(message.text());
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));

// a worker that fails to load only fires an error event on its Worker object
await page.addInitScript(() => {
  globalThis.Worker = class extends Worker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener("error", (event) =>
        console.error(`worker error: ${event.message ?? "failed to load"}`),
      );
    }
  };
});

await page.goto(url);
let start = Date.now();
let done = false;
while (!done && errors.length === 0 && Date.now() - start < timeout) {
  await page.waitForTimeout(200);
  done = await page.evaluate(() => (globalThis as any).browserTestDone);
}
await browser.close();
server.close();

if (!done) {
  console.error(errors.join("\n") || `timed out after ${timeout / 1000}s`);
  process.exit(1);
}
console.log("browser test passed");
