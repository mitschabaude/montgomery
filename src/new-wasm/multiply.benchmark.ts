import { Const, Module, call, func, global, i32, memory } from "wasmati";
import { tic, toc } from "../extra/tictoc.js";
import { p, randomBaseFieldx2 } from "../finite-field/pasta.js";
import { multiplyMontgomery } from "./multiply-montgomery.js";
import { jsHelpers } from "./helpers.js";
import { writeWat } from "./wat-helpers.js";
import { multiplySchoolbook } from "./multiply-schoolbook.js";
import { barrettReduction } from "./barrett.js";
import { FieldWithArithmetic } from "./field-arithmetic.js";
import { ImplicitMemory, forLoop1 } from "./wasm-util.js";
import { fieldInverse } from "./inverse.js";

let N = 1e7;

for (let w of [29]) {
  let {
    benchMultiply: benchMontgomery,
    benchSquare,
    multiply: multiplyMontgomery_,
    leftShift,
  } = multiplyMontgomery(p, w, { countMultiplications: false });
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

  let implicitMemory = new ImplicitMemory(memory({ min: 100 }));

  let { inverse } = fieldInverse(
    implicitMemory,
    Field,
    multiplyMontgomery_,
    leftShift
  );

  const benchInverse = func(
    { in: [i32, i32, i32, i32], locals: [i32], out: [] },
    ([scratch, x, y, N], [i]) => {
      forLoop1(i, 0, N, () => {
        // x <- x + y
        call(Field.add, [x, x, y]);
        // y <- 1/x
        call(inverse, [scratch, y, x]);
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
      benchInverse,
      memory: implicitMemory.memory,
      dataOffset: global(Const.i32(implicitMemory.dataOffset)),
    },
  });
  await writeWat(
    import.meta.url.slice(7).replace(".ts", ".wat"),
    module.toBytes()
  );

  let wasm = (await module.instantiate()).instance.exports;
  let { writeBigint, getPointer, getPointers, n, readBigint } = jsHelpers(
    p,
    w,
    wasm
  );

  let [scratch] = getPointers(10);
  let x = getPointer();
  let x0 = randomBaseFieldx2();
  writeBigint(x, x0);
  let y = getPointer();
  let y0 = randomBaseFieldx2();
  writeBigint(y, y0);
  console.log(scratch, readBigint(x), readBigint(y));

  console.log(`w=${w}, n=${n}, nw=${n * w}, op x ${N}\n`);

  let N2 = 1e1;
  bench2("inverse", () => wasm.benchInverse(scratch, x, y, N2), { N: N2 });

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

function bench2(name: string, compute: () => void, { N }: { N: number }) {
  tic();
  compute();
  let time = toc();
  console.log(`${name} \t ${(N / time / 1e6).toFixed(1).padStart(4)}M ops/s`);
  console.log(`${name} \t ${((time / N) * 1e9).toFixed(0)}ns`);
  console.log();
}
