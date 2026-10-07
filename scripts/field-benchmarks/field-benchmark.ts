import {
  constant,
  Module,
  call,
  func,
  global,
  i32,
  memory,
  type Local,
} from "wasmati";
import { tic, toc } from "../../src/testing/tictoc.ts";
import { multiplyMontgomery } from "../../src/wasm/multiply-montgomery.ts";
import { memoryHelpers } from "../../src/wasm/memory-helpers.ts";
import { writeWat } from "../../src/wasm/wat-helpers.ts";
import { multiplySchoolbook } from "../../src/wasm/multiply-schoolbook.ts";
import { multiplyBarrett } from "../../src/wasm/barrett.ts";
import { FieldWithArithmetic } from "../../src/wasm/field-arithmetic.ts";
import { ImplicitMemory, forLoop1 } from "../../src/wasm/wasm-util.ts";
import { fieldInverse } from "../../src/wasm/inverse.ts";
import { fieldExp } from "../../src/wasm/exp.ts";
import { createSqrt } from "../../src/field-sqrt.ts";
import { createConstants } from "../../src/field-msm.ts";
import { mod, montgomeryParams } from "../../src/bigint/field-util.ts";
import { benchmarkInverses } from "./wide-inverse.ts";
import {
  bigintFromBytes,
  bigintFromBytes32,
  bigintToBytes,
  bigintToBytes32,
  log2,
  randomBytes,
} from "../../src/util.ts";
import { randomGenerators } from "../../src/bigint/field-random.ts";
import { createWasmWithBenches } from "../../src/51x5/field.ts";
import { createField as createWideField } from "../../src/wide/field-base.ts";
import { arithmetic as wideArithmetic } from "../../src/wide/arithmetic.ts";
import { multiplyMontgomery as wideMultiply } from "../../src/wide/multiply.ts";

export { benchmark };

async function benchmark(
  { p, t }: { p: bigint; t: bigint },
  { doWrite = false, onlyQuick = false, wide = false } = {}
) {
  let { randomField, randomFieldx2 } = randomGenerators(p);
  const initial = randomField();
  let N = 1e7;
  let Ninv = 5e5;
  let Npow = 5e4;

  if (wide) {
    const { F, W, x, z, write } = await createWideBenches(p);
    console.log(
      `wide: ${F.n} x 64 bits, ${F.lazy ? "lazy [0, 2p)" : "canonical [0, p)"}`
    );
    write(x, initial);
    bench("multiply wide", W.multiply, { x, z, N });
    write(x, initial);
    bench("square wide", W.square, { x, z, N });
    write(x, initial);
    bench("add wide", W.add, { x, z, N }, 3);
    write(x, initial);
    write(z, 0n);
    bench("sub wide", W.subtract, { x, z, N }, 3);
  }

  if (p < 1n << 255n) {
    let Fp = await createWasmWithBenches(p);
    let x = Fp.Memory.local.getPointer(Fp.size);
    let z = Fp.Memory.local.getPointer(Fp.size);

    Fp.writePair(x, randomField(), randomField());
    bench("multiply 51x5", Fp.Wasm.benchMultiply, { x, N }, 2);

    Fp.writeSingle(x, randomField());
    bench("multiply 51x5 single", Fp.Wasm.benchMultiplySingle, { x, N });

    Fp.writePair(x, randomField(), randomField());
    bench("multiply 51x5 no fma", Fp.Wasm.benchMultiplyNoFma, { x, N }, 2);

    Fp.writeSingle(x, randomField());
    bench("add 51x5", Fp.Wasm.benchAddx3, { x, N }, 3);

    Fp.writeSingle(x, randomField());
    Fp.writeSingle(z, 0n);
    bench("sub 51x5", Fp.Wasm.benchSubx3, { x, z, N }, 3);
  }

  for (let w of [29]) {
    let { n } = montgomeryParams(p, w);
    let {
      benchMultiply: benchMontgomery,
      benchSquare,
      multiply,
      leftShift,
      square,
    } = multiplyMontgomery(p, w, n, { countMultiplications: false });
    let { benchMultiply: benchSchoolbook, multiply: multiplySchoolbook_ } =
      multiplySchoolbook(p, w, n);
    let { benchMultiply: benchBarrett } = multiplyBarrett(
      p,
      w,
      n,
      multiplySchoolbook_
    );

    const Field = {
      ...FieldWithArithmetic(p, w, n),
      multiply,
      leftShift,
      square,
    };

    const benchAdd = func(
      { in: [{ x: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
      ({ x, N }, { i }) => {
        forLoop1(i, 0, N, () => {
          for (let i = 0; i < 3; i++) {
            call(Field.add, { out: x, x, y: x });
          }
        });
      }
    );

    const benchSub = func(
      {
        in: [{ x: i32 }, { z: i32 }, { N: i32 }],
        locals: { i: i32 },
        out: [],
      },
      ({ x, z, N }, { i }) => {
        forLoop1(i, 0, N, () => {
          for (let j = 0; j < 3; j++)
            call(Field.subtract, { out: z, x: z, y: x });
        });
      }
    );

    let implicitMemory = new ImplicitMemory(memory({ min: 100 }));

    let { inverse } = fieldInverse(implicitMemory, Field);

    let module = Module({
      exports: {
        benchMontgomery,
        benchSchoolbook,
        benchBarrett,
        benchSquare,
        benchAdd,
        benchSub,
        exp: fieldExp(Field),

        memory: implicitMemory.memory,
        dataOffset: global(
          constant(() => i32.const(implicitMemory.dataOffset))
        ),

        // stuff needed for sqrt
        copy: Field.copy,
        add: Field.add,
        reduce: Field.reduce,
        isEqual: Field.isEqual,
        isZero: Field.isZero,
        multiply: Field.multiply,
        square: Field.square,
        inverse,
      },
    });
    if (doWrite) {
      await writeWat(
        import.meta.url.slice(7).replace(".ts", ".wat"),
        module.toBytes()
      );
    }

    let wasm = (await module.instantiate()).instance.exports;
    let helpers = memoryHelpers(p, w, n, wasm);
    let { writeBigint, readBigint, getPointer, getPointers } = helpers;

    function benchMultiplyBigint(x0: number, N: number) {
      let x = readBigint(x0);
      for (let i = 0; i < N; i++) {
        x = (x * x) % p;
      }
      (globalThis as any).x = x;
      return x;
    }

    let constants = createConstants(helpers, {
      zero: 0n,
      mg1: mod(1n * Field.R, p),
      mg2: mod(2n * Field.R, p),
    });
    let { sqrt } = createSqrt(Field, wasm, helpers, constants);

    function benchSqrt(x: number, y: number, N: number) {
      let scratch = getPointers(5);
      for (let i = 0; i < N; i++) {
        wasm.add(x, x, y);
        sqrt(scratch, x, x);
      }
      return x;
    }

    let t1 = getPointer();
    writeBigint(t1, (t - 1n) / 2n);

    function benchPow(x: number, N: number) {
      let scratch = getPointer();
      for (let i = 0; i < N; i++) {
        wasm.exp(scratch, x, x, t1);
      }
      return x;
    }

    let x = getPointer(2 * helpers.sizeField); // Schoolbook writes a double-width product.
    let y = getPointer();
    console.log(`w=${w}, n=${n}, nw=${n * w}, op x ${N}\n`);

    writeBigint(x, initial);
    let tMul = bench("multiply montgomery", wasm.benchMontgomery, { x, N });
    writeBigint(x, initial);
    bench("multiply barrett", wasm.benchBarrett, { x, N });
    writeBigint(x, initial);
    bench("multiply schoolbook", wasm.benchSchoolbook, { x, N });
    writeBigint(x, initial);
    bench("multiply square", wasm.benchSquare, { x, N });

    // bench("multiply bigint", benchMultiplyBigint, { x, N });
    writeBigint(x, initial);
    bench("add", wasm.benchAdd, { x, N }, 3);
    writeBigint(x, initial);
    writeBigint(y, 0n);
    bench("sub", wasm.benchSub, { x, z: y, N }, 3);

    if (onlyQuick) continue;

    await benchmarkInverses(p, { wide: false });

    writeBigint(x, randomFieldx2());
    writeBigint(y, randomFieldx2());

    bench2("pow", () => benchPow(x, Npow), { N: Npow, tMul });
    bench2("sqrt", () => benchSqrt(x, y, Npow), { N: Npow, tMul });

    let bytess: Uint8Array[] = Array(Ninv);
    let bigints = Array<bigint>(Ninv);
    let sizeInBits = log2(p);
    let sizeInBytes = Math.ceil(sizeInBits / 8);

    bench2(
      "randomBytes",
      () => {
        for (let i = 0; i < Ninv; i++) {
          bytess[i] = randomBytes(sizeInBytes);
        }
      },
      { N: Ninv, tMul }
    );

    // bigint from bytes
    bench2(
      "bigintFromBytes",
      () => {
        let n = bytess.length;
        for (let i = 0; i < n; i++) {
          bigints[i] = bigintFromBytes(bytess[i]);
        }
      },
      { N: Ninv, tMul }
    );

    bench2(
      "bigintFromBytes32",
      () => {
        let n = bytess.length;
        for (let i = 0; i < n; i++) {
          bigints[i] = bigintFromBytes32(bytess[i]);
        }
      },
      { N: Ninv, tMul }
    );

    // bigint to bytes
    bench2(
      "bigintToBytes",
      () => {
        let n = bigints.length;
        for (let i = 0; i < n; i++) {
          bytess[i] = bigintToBytes(bigints[i], sizeInBytes);
        }
      },
      { N: Ninv, tMul }
    );

    bench2(
      "bigintToBytes32",
      () => {
        let n = bigints.length;
        for (let i = 0; i < n; i++) {
          bytess[i] = bigintToBytes32(bigints[i]);
        }
      },
      { N: Ninv, tMul }
    );
  }
}

function bench(
  name: string,
  compute:
    | ((x: number, N: number) => void)
    | ((x: number, z: number, N: number) => void),
  { x, z, N }: { x: number; z?: number; N: number },
  /**
   * parameter to use if the operation is performed multiple times
   */
  scale = 1
) {
  let Nscaled = Math.round(N / scale);
  name = name.padEnd(20, " ");
  tic();
  if (z === undefined) (compute as (x: number, N: number) => void)(x, Nscaled);
  else compute(x, z, Nscaled);
  let time = toc();
  console.log(`${name} \t ${(N / time / 1e3).toFixed(1).padStart(4)}M ops/s`);
  console.log(`${name} \t ${((time / N) * 1e6).toFixed(0)}ns`);
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
  console.log(`${name} \t ${(N / time).toFixed(0).padStart(4)}K ops/s`);
  console.log(
    `${name} \t ${(time / N / tMul).toFixed(0)} muls / ${(
      (time / N) *
      1e6
    ).toFixed(0)}ns`
  );
  console.log();
}

// Dependent chains of wide arithmetic, x <- op(x, x) (or z <- z - x), in Wasm.
async function createWideBenches(p: bigint) {
  const F = createWideField(p);
  const wasmMemory = memory({ min: 1 });
  const ops = { ...wideArithmetic(F), ...wideMultiply(F) };
  const loop = (op: (x: Local<i32>, z: Local<i32>) => void) =>
    func(
      { in: [{ x: i32 }, { z: i32 }, { N: i32 }], locals: { i: i32 }, out: [] },
      ({ x, z, N }, { i }) => forLoop1(i, 0, N, () => op(x, z))
    );
  const module = Module({
    memory: wasmMemory,
    exports: {
      memory: wasmMemory,
      multiply: loop((x) => call(ops.multiply, { xy: x, x, y: x })),
      square: loop((x) => call(ops.square, { xy: x, x })),
      add: loop((x) => {
        for (let j = 0; j < 3; j++) call(ops.add, { out: x, x, y: x });
      }),
      subtract: loop((x, z) => {
        for (let j = 0; j < 3; j++) call(ops.subtract, { out: z, x: z, y: x });
      }),
    },
  });
  const W = (await module.instantiate()).instance.exports;
  const view = new DataView(W.memory.buffer);
  function write(ptr: number, value: bigint) {
    for (let i = 0; i < F.n; i++, value >>= 64n)
      view.setBigUint64(ptr + 8 * i, BigInt.asUintN(64, value), true);
  }
  return { F, W, x: 0, z: F.size, write };
}
