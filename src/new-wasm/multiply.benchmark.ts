import { Module, memory } from "wasmati";
import { tic, toc } from "../extra/tictoc.js";
import { p, randomBaseFieldx2 } from "../finite-field/pasta.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { jsHelpers, montgomeryParams } from "./helpers.js";
import { writeWat } from "./wat-helpers.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";
import { barrettReduction } from "./barrett.js";

let N = 1e7;

for (let w of [29]) {
  let { benchMultiply: benchMontgomery } = multiplyMontgomery(p, w, {
    countMultiplications: false,
  });
  let { benchMultiply: benchSchoolbook, multiply } = multiplySchoolbook(p, w);
  let { benchMultiply: benchBarrett } = barrettReduction(p, w, multiply);

  let mem = memory({ min: 100 });

  let module = Module({
    exports: { benchMontgomery, benchSchoolbook, benchBarrett, mem },
  });
  await writeWat(
    import.meta.url.slice(7).replace(".ts", ".wat"),
    module.toBytes()
  );

  let wasm = (await module.instantiate()).instance.exports;

  let { n } = montgomeryParams(p, w);
  let helpers = jsHelpers(p, w, wasm.mem);
  let { writeBigint, getPointer } = helpers;

  let x = getPointer();
  let x0 = randomBaseFieldx2();
  writeBigint(x, x0);

  console.log(`w=${w}, n=${n}, nw=${n * w}, op x ${N}\n`);

  bench("multiply montgomery", wasm.benchMontgomery, { x, N });
  bench("multiply barrett", wasm.benchBarrett, { x, N });
  bench("multiply schoolbook", wasm.benchSchoolbook, { x, N });
}

function bench(
  name: string,
  compute: (x: number, N: number) => void,
  { x, N }: { x: number; N: number }
) {
  tic();
  compute(x, N);
  let time = toc();
  console.log(`${name} \t ${(N / time / 1e6).toFixed(1).padStart(4)}M ops/s`);
  console.log(`${name} \t ${((time / N) * 1e9).toFixed(0)}ns`);
  console.log();
}
