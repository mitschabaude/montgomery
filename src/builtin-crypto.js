export { randomBytes, sha512, sha256 };
let crypto = globalThis.crypto ?? (await import("crypto")).webcrypto;

function randomBytes(n) {
  let arr = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    let m = Math.min(n - i, 65536);
    crypto.getRandomValues(arr.subarray(i, i + m));
  }
  return arr;
}

async function sha512(msg) {
  return new Uint8Array(await crypto.subtle.digest("SHA-512", msg));
}
async function sha256(msg) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", msg));
}
