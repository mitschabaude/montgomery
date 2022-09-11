import { tic, toc } from "./src/tictoc.js";
import { randomBaseFieldx2, field, mod } from "./src/finite-field.js";
import fs from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  benchMultiply,
  montgomeryParams,
  multiply32,
  interpretWat,
  jsHelpers,
  moduleWithMemory,
  multiply,
  add,
  benchAdd,
} from "./src/finite-field-generate.js";
import { Writer } from "./src/wasm-generate.js";
globalThis.crypto = webcrypto;

let p = field.p;
let N = 1e7;
for (let w of [24, 26, 28, 30]) {
  let { n } = montgomeryParams(p, w);
  let writer = Writer();
  moduleWithMemory(
    writer,
    `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
    () => {
      multiply(writer, p, w);

      add(writer, p, w);

      benchMultiply(writer);
      benchAdd(writer);
    }
  );
  await fs.writeFile(`./src/finite-field.${w}.gen.wat`, writer.text);
  let wasm = await interpretWat(writer);
  let x = testCorrectness(p, w, wasm);
  tic(`multiply (w=${w}) x ${N}`);
  wasm.benchMultiply(x, N);
  let timeMul = toc();
  console.log(`${(N / timeMul / 1e6).toFixed(2).padStart(5)} mio. mul / s`);

  tic();
  wasm.benchAdd(x, N);
  let timeAdd = toc();
  console.log(
    `${(N / timeAdd / 1e6).toFixed(2)} mio. add / s (add = ${(
      timeAdd / timeMul
    ).toFixed(2)} mul)`
  );
}
{
  let w = 32;
  for (let unrollOuter of [0, 1]) {
    let { n } = montgomeryParams(p, w);
    let writer = Writer();
    moduleWithMemory(
      writer,
      `;; generated for w=${w}, n=${n}, n*w=${n * w}`,
      () => {
        multiply32(writer, p, w, { unrollOuter });
        benchMultiply(writer);
      }
    );
    await fs.writeFile("./src/finite-field.32.gen.wat", writer.text);
    let wasm = await interpretWat(writer);
    let x = testCorrectness(p, w, wasm);
    tic(`multiply (w=${w}, unrolled=${unrollOuter}) x ${N}`);
    wasm.benchMultiply(x, N);
    let time = toc();
    console.log(`${(N / time / 1e6).toFixed(2).padStart(5)} mio. mul / s`);
  }
}

function testCorrectness(p, w, wasm) {
  let { memory, multiply, add } = wasm;
  let { R, writeBigint, readBigInt, getPointers } = jsHelpers(p, w, memory);
  let [x, y, z, R2] = getPointers(4);
  for (let i = 0; i < 100; i++) {
    let x0 = randomBaseFieldx2();
    let y0 = randomBaseFieldx2();
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

    if (add) {
      add(z, x, y);
      z0 = mod(x0 + y0, p);
      z1 = readBigInt(z);
      if (z0 !== z1 && !(z1 > p && z0 + p === z1)) {
        console.log(z0);
        console.log(z0 + p);
        console.log(z1);
        throw Error("bad addition");
      }
    }
  }
  return x;
}
