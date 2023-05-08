import { Const, Module, call, func, global, i32, memory } from "wasmati";
import { tic, toc } from "../src/extra/tictoc.js";
import { p, randomBaseFieldx2 } from "../src/concrete/pasta.js";
import { multiplyMontgomery } from "../src/wasm/multiply-montgomery.js";
import { memoryHelpers } from "../src/wasm/helpers.js";
import { writeWat } from "../src/wasm/wat-helpers.js";
import { multiplySchoolbook } from "../src/wasm/multiply-schoolbook.js";
import { multiplyBarrett } from "../src/wasm/barrett.js";
import { FieldWithArithmetic } from "../src/wasm/field-arithmetic.js";
import { ImplicitMemory, forLoop1 } from "../src/wasm/wasm-util.js";
import { fieldInverse } from "../src/wasm/inverse.js";

let N = 1e7;
let Ninv = 1e5;

for (let w of [29]) {
  let {
    benchMultiply: benchMontgomery,
    benchSquare,
    multiply,
    leftShift,
    square,
  } = multiplyMontgomery(p, w, { countMultiplications: false });
  let { benchMultiply: benchSchoolbook, multiply: multiplySchoolbook_ } =
    multiplySchoolbook(p, w);
  let { benchMultiply: benchBarrett } = multiplyBarrett(
    p,
    w,
    multiplySchoolbook_
  );

  const Field = { ...FieldWithArithmetic(p, w), multiply, leftShift, square };

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

  let { inverse } = fieldInverse(implicitMemory, Field);

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
  let { writeBigint, getPointer, getPointers, n } = memoryHelpers(p, w, wasm);

  let [scratch] = getPointers(10);
  let x = getPointer();
  let y = getPointer();
  writeBigint(x, randomBaseFieldx2());
  writeBigint(y, randomBaseFieldx2());

  console.log(`w=${w}, n=${n}, nw=${n * w}, op x ${N}\n`);

  let tMul = bench("multiply montgomery", wasm.benchMontgomery, { x, N });
  bench("multiply barrett", wasm.benchBarrett, { x, N });
  bench("multiply schoolbook", wasm.benchSchoolbook, { x, N });
  bench("multiply square", wasm.benchSquare, { x, N });

  writeBigint(x, randomBaseFieldx2());
  writeBigint(y, randomBaseFieldx2());

  bench2("inverse", () => wasm.benchInverse(scratch, x, y, Ninv), {
    N: Ninv,
    tMul,
  });

  bench("add x3", wasm.benchAdd, { x, N });
}

function bench(
  name: string,
  compute: (x: number, N: number) => void,
  { x, N }: { x: number; N: number }
) {
  name = name.padEnd(20, " ");
  tic();
  compute(x, N);
  let time = toc();
  console.log(`${name} \t ${(N / time / 1e6).toFixed(1).padStart(4)}M ops/s`);
  console.log(`${name} \t ${((time / N) * 1e9).toFixed(0)}ns`);
  console.log();
  return time / N;
}

function bench2(
  name: string,
  compute: () => void,
  { N, tMul }: { N: number; tMul: number }
) {
  name = name.padEnd(20, " ");
  tic();
  compute();
  let time = toc();
  console.log(`${name} \t ${(N / time / 1e3).toFixed(0).padStart(4)}K ops/s`);
  console.log(
    `${name} \t ${(time / N / tMul).toFixed(0)} muls / ${(
      (time / N) *
      1e9
    ).toFixed(0)}ns`
  );
  console.log();
}
