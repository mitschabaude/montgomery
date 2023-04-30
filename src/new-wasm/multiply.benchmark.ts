import { Module, call, func, i32, memory } from "wasmati";
import { tic, toc } from "../extra/tictoc.js";
import { p, randomBaseFieldx2 } from "../finite-field/pasta.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { jsHelpers } from "./helpers.js";
import { writeWat } from "./wat-helpers.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";
import { barrettReduction } from "./barrett.js";
import {
  FieldWithArithmetic,
  arithmetic,
  fieldHelpers,
} from "./field-arithmetic.js";
import { forLoop1 } from "./wasm-util.js";

let N = 1e7;

for (let w of [29]) {
  let { benchMultiply: benchMontgomery, benchSquare } = multiplyMontgomery(
    p,
    w,
    { countMultiplications: false }
  );
  let { benchMultiply: benchSchoolbook, multiply } = multiplySchoolbook(p, w);
  let { benchMultiply: benchBarrett } = barrettReduction(p, w, multiply);
  const Field = FieldWithArithmetic(p, w);

  const benchAdd = func(
    { in: [i32, i32], locals: [i32], out: [] },
    ([x, N], [i]) => {
      forLoop1(i, 0, N, () => {
        for (let i = 0; i < 3; i++) {
          call(Field.add, [x, x, x]);
        }
      });
    }
  );

  let module = Module({
    exports: {
      benchMontgomery,
      benchSchoolbook,
      benchBarrett,
      benchSquare,
      benchAdd,
      memory: memory({ min: 100 }),
    },
  });
  await writeWat(
    import.meta.url.slice(7).replace(".ts", ".wat"),
    module.toBytes()
  );

  let wasm = (await module.instantiate()).instance.exports;
  let { writeBigint, getPointer, n } = jsHelpers(p, w, wasm);

  let x = getPointer();
  let x0 = randomBaseFieldx2();
  writeBigint(x, x0);

  console.log(`w=${w}, n=${n}, nw=${n * w}, op x ${N}\n`);

  bench("multiply montgomery", wasm.benchMontgomery, { x, N });
  bench("multiply barrett", wasm.benchBarrett, { x, N });
  bench("multiply schoolbook", wasm.benchSchoolbook, { x, N });
  bench("multiply square", wasm.benchSquare, { x, N });
  bench("add x3", wasm.benchAdd, { x, N });
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
