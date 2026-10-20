/**
 * Downloads Firefox builds into ~/.cache/montgomery/ (linux x64)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export { getJsShell, getFirefox };

// `version` is a Firefox release like "158.0", "latest" or "nightly"
async function getJsShell(version = "latest") {
  version = await resolveVersion(version);
  return download(
    `jsshell-${version}`,
    "js",
    version === "nightly"
      ? "https://archive.mozilla.org/pub/firefox/nightly/latest-mozilla-central/jsshell-linux-x86_64.zip"
      : `https://archive.mozilla.org/pub/firefox/releases/${version}/jsshell/jsshell-linux-x86_64.zip`,
  );
}

async function getFirefox(version = "latest") {
  version = await resolveVersion(version);
  if (version === "nightly")
    throw Error("Firefox Nightly downloads are not supported");
  return download(
    `firefox-${version}`,
    "firefox/firefox",
    `https://download-installer.cdn.mozilla.net/pub/firefox/releases/${version}/linux-x86_64/en-US/firefox-${version}.tar.xz`,
  );
}

async function resolveVersion(version: string) {
  if (version !== "latest") return version;
  let res = await fetch(
    "https://product-details.mozilla.org/1.0/firefox_versions.json",
  );
  return (await res.json()).LATEST_FIREFOX_VERSION as string;
}

async function download(name: string, executable: string, url: string) {
  let dir = path.join(os.homedir(), ".cache/montgomery", name);
  let file = path.join(dir, executable);
  if (fs.existsSync(file)) return file;

  console.log(`downloading ${url}`);
  let res = await fetch(url);
  if (!res.ok) throw Error(`${url}: ${res.status}`);
  fs.mkdirSync(dir, { recursive: true });
  let archive = path.join(dir, path.basename(url));
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  if (url.endsWith(".zip")) execFileSync("unzip", ["-qo", archive, "-d", dir]);
  else execFileSync("tar", ["xJf", archive, "-C", dir]);
  fs.rmSync(archive);
  return file;
}
