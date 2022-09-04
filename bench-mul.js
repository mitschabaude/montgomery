import { tic, toc } from "./src/tictoc.js";
import { randomBaseFieldx2, field } from "./src/finite-field.js";

import { webcrypto } from "node:crypto";
import { jsHelpers, wasmArithmetic } from "./src/finite-field-generate.js";
globalThis.crypto = webcrypto;

let p = field.p;
let N = 1e7;

// TODO: make these generic over the word size
let w = 32;
let { benchMultiply, memory } = await wasmArithmetic(p, w);
let helpers = jsHelpers(p, w, memory);
let x0 = randomBaseFieldx2();
let x = 0;
helpers.writeBigint(x, x0);

tic(`multiply (w=${w}) x ${N}`);
benchMultiply(x, N);
let time = toc();
console.log(`${(N / time / 1e6).toFixed(3)} mio. mul / s`);
