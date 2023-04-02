import { Module, memory } from "wasmati";
import { tic, toc } from "../extra/tictoc.js";
import { p, randomBaseFieldx2, mod, beta } from "../finite-field-js.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { jsHelpers } from "./helpers.js";

let N = 1e7;

for (let w of [30]) {
  let { benchMultiply } = multiplyMontgomery(p, w, {
    countMultiplications: true,
  });

  let mem = memory({ min: 100 });

  let module = Module({
    exports: { benchMultiply, mem },
  });
  let wasm = (await module.instantiate()).instance.exports;

  let helpers = jsHelpers(p, w, wasm.mem);
  let { writeBigint, getPointer } = helpers;

  let x = getPointer();
  let x0 = randomBaseFieldx2();
  writeBigint(x, x0);

  tic(`multiply (w=${w}, unrolled=${false}) x ${N}`);
  wasm.benchMultiply(0, N);
  let timeMul = toc();
  console.log(`${(N / timeMul / 1e6).toFixed(2).padStart(5)} mio. mul / s`);
  console.log(`montgomery mul\t ${((timeMul / N) * 1e9).toFixed(0)} ns`);
}
