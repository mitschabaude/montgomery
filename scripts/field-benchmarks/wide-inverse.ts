import assert from "node:assert/strict";
import { Module, call, func, i32, memory, type Func } from "wasmati";
import { FieldWithArithmetic } from "../../src/wasm/field-arithmetic.ts";
import { multiplyMontgomery } from "../../src/wasm/multiply-montgomery.ts";
import { fieldInverse as kaliskiInverse } from "../../src/wasm/inverse.ts";
import { fastInverse } from "../../src/inverse/faster-inverse-wasm.ts";
import { ImplicitMemory, forLoop1 } from "../../src/wasm/wasm-util.ts";
import { createField } from "../../src/wide/field-base.ts";
import { arithmetic } from "../../src/wide/arithmetic.ts";
import { multiplyMontgomery as wideMultiply } from "../../src/wide/multiply.ts";
import { fieldInverse as wideInverse } from "../../src/wide/inverse.ts";
import { inverse } from "../../src/bigint/field.ts";
import { montgomeryParams, mod } from "../../src/bigint/field-util.ts";
import { Random, sample } from "../../src/testing/random.ts";
import { tic, toc } from "../../src/testing/tictoc.ts";

export { benchmarkInverses };

type Inverse = Func<[{ scratch: "i32" }, { r: "i32" }, { a: "i32" }], []>;

// Each timed iteration reads the same immutable sample sequence for every
// implementation. No addition, evolving output/input chain, warmup, or sampling.
async function benchmarkInverses(p: bigint, { wide = true } = {}) {
  const sampleCount = 256;
  const N = 500_000;
  const samples = sample(
    Random.reject(Random.uniformField(p), (a) => a === 0n),
    sampleCount
  );
  const main = await createMain(p);
  const wideField = wide ? await createWide(p) : undefined;
  for (const F of wideField ? [main, wideField] : [main]) {
    samples.forEach((a, j) => F.write(F.inputs + j * F.size, a));
    // Validate every fixture against bigint before timing; this is reported
    // explicitly and does not execute the benchmark loop itself.
    for (const [name, run] of Object.entries(F.inverses)) {
      for (let j = 0; j < samples.length; j++) {
        run(F.scratch, F.output, F.inputs + j * F.size);
        const actual = F.read(F.output);
        assert(actual < 2n * p, `${name}: output bound`);
        assert.equal(
          mod(actual, p),
          mod(inverse(samples[j], p) * F.R * F.R, p),
          `${name}: fixture ${j}`
        );
        assert.equal(
          F.read(F.inputs + j * F.size),
          samples[j],
          `${name}: input preserved`
        );
      }
    }
  }
  console.log(
    `complete ${
      wide ? "main/wide" : "main"
    } inverses: ${sampleCount} shared immutable nonzero raw inputs, all validated against bigint; ${N} fixed-input iterations per row`
  );
  for (const [name, F, run] of [
    ["inverse main fast", main, main.benches.fast],
    ...(wideField
      ? [["inverse wide fast", wideField, wideField.benches.fast] as const]
      : []),
    ["inverse main Kaliski", main, main.benches.kaliski],
    ...(wideField
      ? [
          [
            "inverse wide Kaliski",
            wideField,
            wideField.benches.kaliski,
          ] as const,
        ]
      : []),
  ] as const) {
    tic();
    run(F.scratch, F.output, F.inputs, N);
    const elapsed = toc();
    // Detect the original scratch/input overlap bug outside the timed region.
    samples.forEach((a, j) => {
      assert.equal(
        F.read(F.inputs + j * F.size),
        a,
        `${name}: input ${j} changed during timing`
      );
    });
    console.log(`${name.padEnd(23)} ${((elapsed * 1e6) / N).toFixed(0)} ns`);
  }
}

async function build(
  p: bigint,
  w: number,
  n: number,
  R: bigint,
  mem: ImplicitMemory,
  inverses: { fast: Inverse; kaliski: Inverse }
) {
  const size = n * (w === 64 ? 8 : 4);
  const loop = (operation: Inverse) =>
    func(
      {
        in: [{ scratch: i32 }, { output: i32 }, { inputs: i32 }, { N: i32 }],
        locals: { i: i32 },
        out: [],
      },
      ({ scratch, output, inputs, N }, { i }) => {
        forLoop1(i, 0, N, () => {
          call(operation, {
            scratch,
            r: output,
            a: i32.add(inputs, i32.mul(i32.and(i, 255), size)),
          });
        });
      }
    );
  const module = Module({
    memory: mem.memory,
    exports: {
      ...mem.getExports(),
      ...inverses,
      benchFast: loop(inverses.fast),
      benchKaliski: loop(inverses.kaliski),
    },
  });
  const W = (await module.instantiate()).instance.exports;
  const view = new DataView(W.memory.buffer);
  const scratch = Math.ceil(mem.dataOffset / 8) * 8;
  const output = scratch + 3 * size;
  const inputs = output + size;
  function write(ptr: number, a: bigint) {
    for (let j = 0; j < n; j++, a >>= BigInt(w)) {
      if (w === 64) view.setBigUint64(ptr + j * 8, BigInt.asUintN(64, a), true);
      else
        view.setUint32(ptr + j * 4, Number(a & ((1n << BigInt(w)) - 1n)), true);
    }
  }
  function read(ptr: number) {
    let a = 0n;
    for (let j = n - 1; j >= 0; j--)
      a =
        (a << BigInt(w)) |
        (w === 64
          ? view.getBigUint64(ptr + j * 8, true)
          : BigInt(view.getUint32(ptr + j * 4, true)));
    return a;
  }
  return {
    W,
    p,
    R,
    size,
    scratch,
    output,
    inputs,
    write,
    read,
    inverses: { fast: W.fast, kaliski: W.kaliski },
    benches: { fast: W.benchFast, kaliski: W.benchKaliski },
  };
}

async function createMain(p: bigint) {
  const w = 29,
    { n } = montgomeryParams(p, w);
  const mem = new ImplicitMemory(memory({ min: 100 }));
  const F = {
    ...FieldWithArithmetic(p, w, n),
    ...multiplyMontgomery(p, w, n, { countMultiplications: false }),
  };
  return build(p, w, n, F.R, mem, {
    fast: fastInverse(mem, F).inverse,
    kaliski: kaliskiInverse(mem, F).inverse,
  });
}

async function createWide(p: bigint) {
  const F = createField(p);
  const mem = new ImplicitMemory(memory({ min: 100 }));
  const ops = { ...arithmetic(F), ...wideMultiply(F) };
  const I = wideInverse(F, ops, mem);
  return build(p, 64, F.n, F.R, mem, {
    fast: I.inverse,
    kaliski: I.inverseKaliski,
  });
}
