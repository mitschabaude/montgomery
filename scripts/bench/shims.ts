/**
 * Globals that the SpiderMonkey shell lacks but our scripts use.
 * Injected into every shell bundle by ./run.ts.
 */
declare const scriptArgs: string[];
declare const __SHELL_VERSION__: string;

// benchmarks only need random inputs, not secure randomness
globalThis.crypto ??= {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    let bytes = new Uint8Array(
      array!.buffer,
      array!.byteOffset,
      array!.byteLength,
    );
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
    return array;
  },
} as Crypto;

globalThis.TextEncoder ??= class {
  encode(string: string) {
    let bytes: number[] = [];
    for (let byte of unescape(encodeURIComponent(string)))
      bytes.push(byte.charCodeAt(0));
    return new Uint8Array(bytes);
  }
} as any;

globalThis.TextDecoder ??= class {
  decode(bytes: Uint8Array) {
    return decodeURIComponent(escape(String.fromCharCode(...bytes)));
  }
} as any;

globalThis.process ??= {
  argv: ["js", "script", ...scriptArgs],
  version: __SHELL_VERSION__,
  versions: {},
} as any;

console.assert ??= (condition: unknown, ...message: unknown[]) => {
  if (!condition) console.error("Assertion failed:", ...message);
};
