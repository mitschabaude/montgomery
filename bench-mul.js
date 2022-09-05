import { tic, toc } from "./src/tictoc.js";
import { randomBaseFieldx2, field, mod } from "./src/finite-field.js";
import fs from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  benchMultiply,
  montgomeryParams,
  generateMultiply32,
  interpretWat,
  jsHelpers,
  moduleWithMemory,
} from "./src/finite-field-generate.js";
import { Writer } from "./src/wasm-generate.js";
globalThis.crypto = webcrypto;

let p = field.p;
let N = 1e7;
{
  let w = 32;
  let unrollOuter = 1;
  let { n } = montgomeryParams(p, w);
  let writer = Writer();
  moduleWithMemory(
    writer,
    `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
    () => {
      generateMultiply32(writer, p, w, { unrollOuter });
      benchMultiply(writer);
    }
  );
  await fs.writeFile("./src/finite-field.32.gen.wat", writer.text);
  let wasm = await interpretWat(writer);
  let x = testCorrectness(p, w, wasm);
  tic(`multiply (w=${w}, unrolled=${unrollOuter}) x ${N}`);
  wasm.benchMultiply(x, N);
  let time = toc();
  console.log(`${(N / time / 1e6).toFixed(3)} mio. mul / s`);
}
{
  let w = 32;
  let unrollOuter = 0;
  let { n } = montgomeryParams(p, w);
  let writer = Writer();
  moduleWithMemory(
    writer,
    `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
    () => {
      generateMultiply32(writer, p, w, { unrollOuter });
      benchMultiply(writer);
    }
  );
  await fs.writeFile("./src/finite-field.32.gen.wat", writer.text);
  let wasm = await interpretWat(writer);
  let x = testCorrectness(p, w, wasm);
  tic(`multiply (w=${w}, unrolled=${unrollOuter}) x ${N}`);
  wasm.benchMultiply(x, N);
  let time = toc();
  console.log(`${(N / time / 1e6).toFixed(3)} mio. mul / s`);
}

function testCorrectness(p, w, wasm) {
  let { memory, multiply } = wasm;
  let { R, writeBigint, readBigInt, getPointers } = jsHelpers(p, w, memory);
  let x0 = randomBaseFieldx2();
  let y0 = randomBaseFieldx2();
  let [x, y, z, R2] = getPointers(4);
  writeBigint(x, x0);
  writeBigint(y, y0);
  writeBigint(R2, mod(R * R, p));
  multiply(z, x, y);
  let z0 = mod(x0 * y0, p);
  multiply(z, z, R2);
  let z1 = readBigInt(z);
  if (z0 !== z1 && !(z1 > p && z0 + p === z1)) {
    throw Error("bad multiplication");
  }
  return x;
}
