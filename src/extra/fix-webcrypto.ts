import { webcrypto } from "node:crypto";
// web crypto compat
if (Number(process.version.slice(1, 3)) < 19) {
  globalThis.crypto = webcrypto as any;
}
