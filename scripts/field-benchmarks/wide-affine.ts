import { Module, call, func, i32, local, memory, type Func } from "wasmati";
import { FieldWithArithmetic } from "../../src/wasm/field-arithmetic.ts";
import { multiplyMontgomery } from "../../src/wasm/multiply-montgomery.ts";
import { forLoop1 } from "../../src/wasm/wasm-util.ts";
import { montgomeryParams } from "../../src/bigint/field-util.ts";
import { randomGenerators } from "../../src/bigint/field-random.ts";
import { createField } from "../../src/wide/field-base.ts";
import { arithmetic } from "../../src/wide/arithmetic.ts";
import { multiplyMontgomery as wideMultiply } from "../../src/wide/multiply.ts";

export { benchmarkAffine };

type Binary<A extends string> = Func<
  readonly [{ [k in A]: "i32" }, { x: "i32" }, { y: "i32" }],
  []
>;
type Ops = {
  multiply: Binary<"xy">;
  square: Func<readonly [{ xy: "i32" }, { x: "i32" }], []>;
  add: Binary<"out">;
  subtract: Binary<"out">;
  copy: Func<readonly [{ x: "i32" }, { y: "i32" }], []>;
};

const K = 1024;
const rounds = 2000;

// The field operations of a batch-affine point addition, G1 <- G1 + G2 given
// d = 1/(x2 - x1), over many independent random inputs as in an MSM bucket
// pass. Both backends run the same generated code, so branch prediction and
// instruction scheduling match real use better than dependent chains.
async function benchmarkAffine(p: bigint) {
  const { n } = montgomeryParams(p, 29);
  const main = FieldWithArithmetic(p, 29, n);
  const W = createField(p);
  const ops29 = {
    ...main,
    ...multiplyMontgomery(p, 29, n, { countMultiplications: false }),
  };
  const ns29 = await run(ops29, main.size, (x) => main.bigintToData(x));
  const opsWide = { ...arithmetic(W), ...wideMultiply(W) };
  const nsWide = await run(opsWide, W.size, (x) =>
    Array.from({ length: W.size }, (_, i) =>
      Number((x >> BigInt(8 * i)) & 255n)
    )
  );
  const label = "affine addition field ops".padEnd(28);
  console.log(
    `${label}${ns29.toFixed(0)} ns (29-bit) → ${nsWide.toFixed(0)} ns (wide)`
  );

  async function run(o: Ops, S: number, toBytes: (x: bigint) => number[]) {
    const body = func(
      {
        in: [{ x1: i32 }],
        locals: { y1: i32, x2: i32, y2: i32, d: i32, m: i32, t: i32 },
        out: [],
      },
      ({ x1 }, { y1, x2, y2, d, m, t }) => {
        local.set(y1, i32.add(x1, S));
        local.set(x2, i32.add(x1, 2 * S));
        local.set(y2, i32.add(x1, 3 * S));
        local.set(d, i32.add(x1, 4 * S));
        local.set(m, i32.add(x1, 5 * S));
        local.set(t, i32.add(x1, 6 * S));
        // m = (y2 - y1) d, x3 = m^2 - x1 - x2, y3 = (x1 - x3) m - y1
        call(o.subtract, { out: m, x: y2, y: y1 });
        call(o.multiply, { xy: m, x: m, y: d });
        call(o.square, { xy: t, x: m });
        call(o.subtract, { out: t, x: t, y: x1 });
        call(o.subtract, { out: t, x: t, y: x2 });
        call(o.subtract, { out: x2, x: x1, y: t });
        call(o.multiply, { xy: x2, x: x2, y: m });
        call(o.subtract, { out: y1, x: x2, y: y1 });
        call(o.copy, { x: x1, y: t });
        // fresh x2 for the next round
        call(o.add, { out: x2, x: x1, y: d });
      }
    );
    const bench = func(
      { in: [{ N: i32 }], locals: { i: i32, k: i32 }, out: [] },
      ({ N }, { i, k }) => {
        forLoop1(i, 0, N, () => {
          forLoop1(k, 0, K, () => call(body, { x1: i32.mul(k, 7 * S) }));
        });
      }
    );
    const mem = memory({ min: 16 });
    const module = Module({ memory: mem, exports: { bench, memory: mem } });
    const { bench: runBench, memory: wasmMemory } = (await module.instantiate())
      .instance.exports;
    const bytes = new Uint8Array(wasmMemory.buffer);
    const { randomField } = randomGenerators(p);
    for (let j = 0; j < 7 * K; j++) bytes.set(toBytes(randomField()), j * S);
    // a single timed run, like the other rows
    const start = performance.now();
    runBench(rounds);
    return ((performance.now() - start) * 1e6) / (rounds * K);
  }
}
