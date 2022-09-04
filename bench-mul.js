import { tic, toc } from "./src/tictoc.js";
import { randomBaseFieldx2, field, mod } from "./src/finite-field.js";

import { webcrypto } from "node:crypto";
import { jsHelpers, wasmArithmetic } from "./src/finite-field-generate.js";
globalThis.crypto = webcrypto;

let p = field.p;
let N = 1e7;

// TODO: make these generic over the word size
let w = 32;
let { multiply, benchMultiply, memory } = await wasmArithmetic(p, w);
let { R, writeBigint, readBigInt, getPointers } = jsHelpers(p, w, memory);
let x0 = randomBaseFieldx2();
let y0 = randomBaseFieldx2();
let [x, y, z, R2] = getPointers(4);
writeBigint(x, x0);
writeBigint(y, y0);
writeBigint(R2, mod(R * R, p));

// first, test that multiplication yields expected result
multiply(z, x, y);
let z0 = mod(x0 * y0, p);
multiply(z, z, R2);
let z1 = readBigInt(z);
if (z0 !== z1 && !(z1 > p && z0 + p === z1)) {
  throw Error("bad multiplication");
}

tic(`multiply (w=${w}) x ${N}`);
benchMultiply(x, N);
let time = toc();
console.log(`${(N / time / 1e6).toFixed(3)} mio. mul / s`);
