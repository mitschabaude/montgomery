import { Module, memory } from "wasmati";
import { tic, toc } from "../extra/tictoc.js";
import { p, randomBaseFieldx2 } from "../finite-field/pasta.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { jsHelpers } from "./helpers.js";
import { writeWat } from "./wat-helpers.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";

let N = 1e7;

for (let w of [30]) {
  let { benchMultiply } = multiplyMontgomery(p, w, {
    countMultiplications: true,
  });
  let { benchMultiply: benchSchoolbook } = multiplySchoolbook(p, w);

  let mem = memory({ min: 100 });

  let module = Module({
    exports: { benchMultiply, benchSchoolbook, mem },
  });
  await writeWat(
    import.meta.url.slice(7).replace(".ts", ".wat"),
    module.toBytes()
  );

  let wasm = (await module.instantiate()).instance.exports;

  let helpers = jsHelpers(p, w, wasm.mem);
  let { writeBigint, getPointer } = helpers;

  let x = getPointer();
  let x0 = randomBaseFieldx2();
  writeBigint(x, x0);

  tic(`multiply montgomery (w=${w}, unrolled=${false}) x ${N}`);
  wasm.benchMultiply(x, N);
  let timeMul = toc();
  console.log(`${(N / timeMul / 1e6).toFixed(2).padStart(5)} mio. mul / s`);
  console.log(`multiply montgomery\t ${((timeMul / N) * 1e9).toFixed(0)} ns`);

  tic(`multiply schoolbook (w=${w}, unrolled=${false}) x ${N}`);
  wasm.benchSchoolbook(x, N);
  let timeSch = toc();
  console.log(`${(N / timeSch / 1e6).toFixed(2).padStart(5)} mio. mul / s`);
  console.log(`multiply schoolbook\t ${((timeSch / N) * 1e9).toFixed(0)} ns`);
}
