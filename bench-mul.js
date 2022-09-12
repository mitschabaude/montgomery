import { tic, toc } from "./src/tictoc.js";
import { p, randomBaseFieldx2, mod } from "./src/finite-field-js.js";
import fs from "node:fs/promises";
import { webcrypto } from "node:crypto";
import {
  createFiniteField,
  benchMultiply,
  montgomeryParams,
  multiply32,
  moduleWithMemory,
  jsHelpers,
} from "./src/finite-field-generate.js";
import { Writer } from "./src/wasm-generate.js";
import {
  compileFiniteFieldWasm,
  interpretWat,
} from "./src/finite-field-compile.js";
globalThis.crypto = webcrypto;

let N = 1e7;
// for (let w of [24, 26, 28, 30]) {
for (let w of [28]) {
  await compileFiniteFieldWasm(p, w, { withBenchmarks: true });
  let wasm = await import(`./src/finite-field.${w}.gen.wat.js`);
  let ff = await createFiniteField(p, w, wasm);
  let [x, z] = testCorrectness(p, w, ff);
  tic(`multiply (w=${w}) x ${N}`);
  ff.benchMultiply(x, N);
  let timeMul = toc();
  console.log(`${(N / timeMul / 1e6).toFixed(2).padStart(5)} mio. mul / s`);

  tic();
  ff.benchAdd(x, N);
  let timeAdd = toc();
  console.log(
    `${(N / timeAdd / 1e6).toFixed(2)} mio. add / s (add = ${(
      timeAdd / timeMul
    ).toFixed(2)} mul)`
  );
  tic();
  ff.benchSubtract(z, x, N);
  let timeSubtract = toc();
  console.log(
    `${(N / timeSubtract / 1e6).toFixed(2)} mio. sub / s (sub = ${(
      timeSubtract / timeMul
    ).toFixed(2)} mul)`
  );
}
{
  let w = 32;
  // for (let unrollOuter of [0, 1]) {
  for (let unrollOuter of []) {
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
    let helpers = jsHelpers(p, w, wasm.memory);
    let x = testCorrectness(p, w, { ...helpers, ...wasm });
    tic(`multiply (w=${w}, unrolled=${unrollOuter}) x ${N}`);
    wasm.benchMultiply(x, N);
    let time = toc();
    console.log(`${(N / time / 1e6).toFixed(2).padStart(5)} mio. mul / s`);
  }
}

function testCorrectness(p, w, ff) {
  let {
    multiply,
    add,
    subtract,
    reduce,
    isEqual,
    isZero,
    isGreater,
    makeOdd,
    shiftByWord,
    inverse,
    R,
    writeBigint,
    readBigInt,
    getPointers,
  } = ff;
  let [x, y, z, R2] = getPointers(4);
  let scratch = getPointers(10);
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
        throw Error("bad addition");
      }
    }
    if (subtract) {
      subtract(z, x, y);
      z0 = mod(x0 - y0, p);
      z1 = readBigInt(z);
      if (z0 !== z1 && !(z1 > p && z0 + p === z1)) {
        throw Error("bad subtraction");
      }
    }
    if (reduce) {
      reduce(x);
      z0 = mod(x0, p);
      z1 = readBigInt(x);
      if (z0 !== z1) {
        throw Error("bad reduce");
      }
      writeBigint(x, x0);
    }
    if (isEqual) {
      if (isEqual(x, x) !== 1) throw Error("bad isEqual");
      if (isEqual(x, y) !== 0) throw Error("bad isEqual");
      writeBigint(z, 0n);
      if (isZero(z) !== 1) throw Error("bad isZero");
      if (isZero(x) !== 0) throw Error("bad isZero");
      writeBigint(z, 1n);
      add(z, x, z);
      if (isGreater(z, x) !== 1) throw Error("bad isGreater");
      if (isGreater(x, x) !== 0) throw Error("bad isGreater");
      if (isGreater(x, z) !== 0) throw Error("bad isGreater");
    }
    if (makeOdd) {
      // shiftByWord
      let wn = BigInt(w);
      writeBigint(x, (x0 >> 120n) << 120n);
      writeBigint(z, 1n);
      shiftByWord(x, z);
      if (readBigInt(x) !== (x0 >> 120n) << (120n - wn))
        throw Error("bad shiftByWord");
      if (readBigInt(z) !== 1n << wn) throw Error("bad shiftByWord");

      // makeOdd
      let m = 117;
      writeBigint(x, 5n << BigInt(m));
      writeBigint(z, 3n);
      let k = makeOdd(x, z);
      if (k !== m) throw Error("bad makeOdd");
      if (readBigInt(x) !== 5n) throw Error("bad makeOdd");
      if (readBigInt(z) !== 3n << BigInt(m)) throw Error("bad makeOdd");
    }
    if (inverse) {
      writeBigint(x, x0);
      multiply(x, x, R2); // x -> xR
      inverse(scratch, z, x); // z = 1/x R
      multiply(z, z, x); // x/x R = 1R
      z1 = readBigInt(z);
      if (mod(z1, p) !== mod(R, p)) throw Error("inverse");
    }
  }
  return [x, z];
}
